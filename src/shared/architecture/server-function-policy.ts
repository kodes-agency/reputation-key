// What a server function's handler reaches, read from source.
//
// A server function is `const name = createServerFn(...)...handler(...)`. Its
// handler decides nothing about who may run it unless the code it runs asks:
// the execution policy (`requireExecutionAllowed`) for a signed-in member, or a
// guard of another kind for a caller the policy does not know (a guest, an
// operator, a person signing in). This module answers one question for the
// canary beside it: starting from the declaration, which of those guards can
// the handler reach?
//
// Reach follows names, never values:
//   - a name declared at the top of the same file (a function, a
//     `createServerOnlyFn` handler, a helper the handler is built from);
//   - a name imported from another module of the server adapter layer
//     (`src/contexts/<context>/server/`), where the walk continues.
// It stops at every other import. The composition root, a use case and a
// repository are not followed, so a policy call somewhere below the adapter
// does not count for the handler above it.
//
// What this proves is that the call is written on a path from the handler. It
// does not prove the call runs first, runs on every branch, or names the right
// action: those belong to the handler's own tests.
//
// A name is matched by spelling. One declared again inside the code being read
// (a parameter, a local) hides the top-level name and is not followed, which
// errs towards reporting.

import { dirname, join, sep } from 'node:path'
import ts from 'typescript'
import { isReference } from './source-syntax'

/** The execution policy every signed-in server function asks. */
export const EXECUTION_POLICY = 'requireExecutionAllowed'

const SERVER_FUNCTION_FACTORY = 'createServerFn'
const SOURCE_ALIAS = '#/'
const SOURCE_ROOT = 'src'
const SERVER_LAYER = /^src\/contexts\/[^/]+\/server\//u
const SOURCE_FILE = /\.tsx?$/u
const NOT_PRODUCTION = /\.(?:test|stories)\.tsx?$|\.d\.ts$/u
const RESOLVED_SUFFIXES = ['.ts', '.tsx', '/index.ts'] as const

type ImportedName = Readonly<{ specifier: string; name: string }>

type ModuleShape = Readonly<{
  /** Repository-relative path, forward slashes. */
  file: string
  sourceFile: ts.SourceFile
  /** Top-level name → the node that declares it. */
  declarations: ReadonlyMap<string, ts.Node>
  /** Local name → where it is imported from, and under which name. */
  imports: ReadonlyMap<string, ImportedName>
  /** Exported name → the module it is re-exported from. */
  reExports: ReadonlyMap<string, ImportedName>
}>

export type ServerFunctionReach = Readonly<{
  /** Repository-relative path of the module that declares the function. */
  file: string
  /** The exported name of the server function. */
  name: string
  /** The names its handler calls, directly or through what it reaches. */
  calls: ReadonlySet<string>
}>

/** Reads modules by repository-relative path; null when there is none. */
export type SourceReader = (file: string) => string | null

const toPosix = (path: string): string => path.split(sep).join('/')

function declarationName(name: ts.BindingName | undefined): string | null {
  return name !== undefined && ts.isIdentifier(name) ? name.text : null
}

function topLevelDeclarations(sourceFile: ts.SourceFile): ReadonlyMap<string, ts.Node> {
  const declarations = new Map<string, ts.Node>()
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      const name = declarationName(statement.name)
      if (name !== null) declarations.set(name, statement)
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const name = declarationName(declaration.name)
        if (name !== null) declarations.set(name, declaration)
      }
    }
  }
  return declarations
}

function specifierText(node: ts.Expression | undefined): string | null {
  return node !== undefined && ts.isStringLiteral(node) ? node.text : null
}

function namedImports(sourceFile: ts.SourceFile): ReadonlyMap<string, ImportedName> {
  const imports = new Map<string, ImportedName>()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    const specifier = specifierText(statement.moduleSpecifier)
    const bindings = statement.importClause?.namedBindings
    if (specifier === null || bindings === undefined || !ts.isNamedImports(bindings)) {
      continue
    }
    for (const element of bindings.elements) {
      imports.set(element.name.text, {
        specifier,
        name: element.propertyName?.text ?? element.name.text,
      })
    }
  }
  return imports
}

function namedReExports(sourceFile: ts.SourceFile): ReadonlyMap<string, ImportedName> {
  const reExports = new Map<string, ImportedName>()
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement)) continue
    const specifier = specifierText(statement.moduleSpecifier)
    const clause = statement.exportClause
    if (specifier === null || clause === undefined || !ts.isNamedExports(clause)) continue
    for (const element of clause.elements) {
      reExports.set(element.name.text, {
        specifier,
        name: element.propertyName?.text ?? element.name.text,
      })
    }
  }
  return reExports
}

function moduleShape(file: string, text: string): ModuleShape {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  return {
    file,
    sourceFile,
    declarations: topLevelDeclarations(sourceFile),
    imports: namedImports(sourceFile),
    reExports: namedReExports(sourceFile),
  }
}

/** `createServerFn` at the root of `createServerFn(...).validator(...).handler(...)`. */
function chainRoot(expression: ts.Expression): ts.Expression {
  let current = expression
  while (
    ts.isCallExpression(current) &&
    ts.isPropertyAccessExpression(current.expression)
  ) {
    current = current.expression.expression
  }
  return current
}

function isServerFunction(declaration: ts.VariableDeclaration): boolean {
  if (declaration.initializer === undefined) return false
  const root = chainRoot(declaration.initializer)
  return (
    ts.isCallExpression(root) &&
    ts.isIdentifier(root.expression) &&
    root.expression.text === SERVER_FUNCTION_FACTORY
  )
}

function serverFunctionDeclarations(
  module: ModuleShape,
): ReadonlyMap<string, ts.VariableDeclaration> {
  const found = new Map<string, ts.VariableDeclaration>()
  for (const [name, node] of module.declarations) {
    if (ts.isVariableDeclaration(node) && isServerFunction(node)) found.set(name, node)
  }
  return found
}

function isLocalDeclaration(node: ts.Node): node is ts.NamedDeclaration {
  return (
    ts.isVariableDeclaration(node) ||
    ts.isParameter(node) ||
    ts.isBindingElement(node) ||
    ts.isFunctionDeclaration(node)
  )
}

/** Names declared inside `root`: each hides a top-level name of the same spelling. */
function namesDeclaredWithin(root: ts.Node): ReadonlySet<string> {
  const declared = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (node !== root && isLocalDeclaration(node) && node.name !== undefined) {
      if (ts.isIdentifier(node.name)) declared.add(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(root)
  return declared
}

type NamesRead = Readonly<{
  /** Every name the code reads, whether it calls it or hands it on. */
  referenced: ReadonlySet<string>
  /** The names it calls. */
  called: ReadonlySet<string>
}>

function namesRead(root: ts.Node): NamesRead {
  const hidden = namesDeclaredWithin(root)
  const referenced = new Set<string>()
  const called = new Set<string>()
  const visit = (node: ts.Node): void => {
    // A type names nothing that runs.
    if (ts.isTypeNode(node)) return
    if (ts.isIdentifier(node) && isReference(node) && !hidden.has(node.text)) {
      referenced.add(node.text)
      if (ts.isCallExpression(node.parent) && node.parent.expression === node) {
        called.add(node.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(root)
  return { referenced, called }
}

function resolveSpecifier(
  fromFile: string,
  specifier: string,
  read: SourceReader,
): string | null {
  const base = specifier.startsWith(SOURCE_ALIAS)
    ? `${SOURCE_ROOT}/${specifier.slice(SOURCE_ALIAS.length)}`
    : specifier.startsWith('.')
      ? toPosix(join(dirname(fromFile), specifier))
      : null
  if (base === null) return null
  const candidates = [base, ...RESOLVED_SUFFIXES.map((suffix) => `${base}${suffix}`)]
  return (
    candidates.find(
      (candidate) => SOURCE_FILE.test(candidate) && read(candidate) !== null,
    ) ?? null
  )
}

type Walk = Readonly<{
  read: SourceReader
  modules: Map<string, ModuleShape | null>
  /** `file#name` of every declaration already read. */
  seen: Set<string>
  calls: Set<string>
}>

function loadModule(walk: Walk, file: string): ModuleShape | null {
  if (!walk.modules.has(file)) {
    const text = walk.read(file)
    walk.modules.set(file, text === null ? null : moduleShape(file, text))
  }
  return walk.modules.get(file) ?? null
}

/** The module of the server adapter layer an imported name comes from, if any. */
function importedFrom(
  walk: Walk,
  module: ModuleShape,
  imported: ImportedName,
): ModuleShape | null {
  const target = resolveSpecifier(module.file, imported.specifier, walk.read)
  if (target === null || !SERVER_LAYER.test(target)) return null
  return loadModule(walk, target)
}

function followName(walk: Walk, module: ModuleShape, name: string): void {
  const key = `${module.file}#${name}`
  if (walk.seen.has(key)) return
  walk.seen.add(key)

  const declaration = module.declarations.get(name)
  if (declaration !== undefined) {
    followNode(walk, module, declaration)
    return
  }
  const elsewhere = module.imports.get(name) ?? module.reExports.get(name)
  if (elsewhere === undefined) return
  const target = importedFrom(walk, module, elsewhere)
  if (target !== null) followName(walk, target, elsewhere.name)
}

function followNode(walk: Walk, module: ModuleShape, node: ts.Node): void {
  const { referenced, called } = namesRead(node)
  // A call is recorded under the name its module exports, so an aliased import
  // of the policy is still the policy.
  for (const name of called) walk.calls.add(module.imports.get(name)?.name ?? name)
  for (const name of referenced) followName(walk, module, name)
}

/** Every server function of one module, with the names its handler reaches. */
export function serverFunctionReachesOf(
  file: string,
  read: SourceReader,
): readonly ServerFunctionReach[] {
  const modules = new Map<string, ModuleShape | null>()
  const text = read(file)
  if (text === null) return []
  const module = moduleShape(file, text)
  modules.set(file, module)

  const reaches: ServerFunctionReach[] = []
  for (const [name, declaration] of serverFunctionDeclarations(module)) {
    const walk: Walk = {
      read,
      modules,
      seen: new Set([`${file}#${name}`]),
      calls: new Set(),
    }
    followNode(walk, module, declaration)
    reaches.push({ file, name, calls: walk.calls })
  }
  return reaches
}

/** True for a module that ships: not a test, a story or a declaration file. */
export function isProductionSource(file: string): boolean {
  return SOURCE_FILE.test(file) && !NOT_PRODUCTION.test(file)
}

/** Every server function of the given modules, with what each handler reaches. */
export function serverFunctionReaches(
  files: readonly string[],
  read: SourceReader,
): readonly ServerFunctionReach[] {
  return files
    .filter((file) => read(file)?.includes(`${SERVER_FUNCTION_FACTORY}(`) === true)
    .sort()
    .flatMap((file) => serverFunctionReachesOf(file, read))
}
