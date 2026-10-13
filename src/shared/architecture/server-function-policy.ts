// What a server function's handler reaches, read from source.
//
// A server function is `const name = createServerFn(...)...handler(...)`. Its
// handler decides nothing about who may run it unless the code it runs asks:
// the execution policy (`requireExecutionAllowed`) for a signed-in member, or a
// guard of another kind for a caller the policy does not know (a guest, an
// operator, a person signing in). This module answers two questions for the
// canary beside it: starting from the declaration, which of those guards can
// the handler reach? And is every server function a declaration it read?
//
// A declaration is read when it is a top-level `const` whose value is a chain
// of calls rooted in a call of the factory. The factory is the name
// `createServerFn`, any alias an import gives it, and the member of that name
// on a namespace import; type arguments, parentheses, `as`, `satisfies` and `!`
// around the chain change nothing. A module that hands the factory on under its
// own name (inbox-shared.ts does) is covered by the first of those: its
// importers still import `createServerFn`.
//
// Every other use of the factory is one this module cannot name a server
// function for: a call inside a wrapper, an object, a function or a default
// export, a second local name, a rename on export. `serverFunctionFactoryUses`
// lists each use and says which declaration, if any, was read from it, so the
// canary fails on a shape it would otherwise pass unseen. Two forms stay out of
// reach: a member looked up by a computed key, and the same function exported
// by another package under another name.
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
// errs towards reporting. The policy is the one exception: a call counts as the
// policy only under the name its own module exports.

import { dirname, join, sep } from 'node:path'
import ts from 'typescript'
import { isReference, unwrap } from './source-syntax'

/** The execution policy every signed-in server function asks. */
export const EXECUTION_POLICY = 'requireExecutionAllowed'

const EXECUTION_POLICY_MODULE = '#/shared/auth/execution-policy'
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

/** One place a module uses the server function factory. */
export type ServerFunctionFactoryUse = Readonly<{
  /** Repository-relative path of the module. */
  file: string
  /** The line of the use, counted from one. */
  line: number
  /** The server function read from this use; null when none was. */
  declaredAs: string | null
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

/** The names a module calls the factory by: its own, and any alias an import gives it. */
function factoryNames(module: ModuleShape): ReadonlySet<string> {
  const names = new Set([SERVER_FUNCTION_FACTORY])
  for (const [local, imported] of module.imports) {
    if (imported.name === SERVER_FUNCTION_FACTORY) names.add(local)
  }
  return names
}

/** `Start.createServerFn` and `Start['createServerFn']`: the factory on a namespace. */
function isFactoryMember(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text === SERVER_FUNCTION_FACTORY
  }
  return (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression) &&
    node.argumentExpression.text === SERVER_FUNCTION_FACTORY
  )
}

function isFactory(names: ReadonlySet<string>, node: ts.Node): boolean {
  return ts.isIdentifier(node) ? names.has(node.text) : isFactoryMember(node)
}

/**
 * The factory call at the root of `createServerFn(...).validator(...).handler(...)`,
 * through any parentheses or casts around the chain or inside it.
 */
function factoryCallAtRoot(
  names: ReadonlySet<string>,
  initializer: ts.Expression,
): ts.CallExpression | null {
  let current = unwrap(initializer)
  while (ts.isCallExpression(current)) {
    const callee = unwrap(current.expression)
    if (isFactory(names, callee)) return current
    if (!ts.isPropertyAccessExpression(callee)) return null
    current = unwrap(callee.expression)
  }
  return null
}

type ServerFunctionDeclaration = Readonly<{
  name: string
  node: ts.VariableDeclaration
  /** The factory as the root call names it: an identifier or a member access. */
  factory: ts.Node
}>

function serverFunctionDeclarations(
  module: ModuleShape,
): readonly ServerFunctionDeclaration[] {
  const names = factoryNames(module)
  const found: ServerFunctionDeclaration[] = []
  for (const [name, node] of module.declarations) {
    if (!ts.isVariableDeclaration(node) || node.initializer === undefined) continue
    const root = factoryCallAtRoot(names, node.initializer)
    if (root !== null) found.push({ name, node, factory: unwrap(root.expression) })
  }
  return found
}

/** `export { createServerFn as other }`: importers no longer import it by its name. */
function leavesUnderAnotherName(
  names: ReadonlySet<string>,
  specifier: ts.ExportSpecifier,
): boolean {
  const local = (specifier.propertyName ?? specifier.name).text
  return names.has(local) && specifier.name.text !== SERVER_FUNCTION_FACTORY
}

/** `const { createServerFn: other } = ...`: the factory taken under another name. */
function isTakenUnderAnotherName(node: ts.Node): boolean {
  return (
    ts.isBindingElement(node) &&
    node.propertyName !== undefined &&
    ts.isIdentifier(node.propertyName) &&
    node.propertyName.text === SERVER_FUNCTION_FACTORY
  )
}

function isFactoryUse(names: ReadonlySet<string>, node: ts.Node): boolean {
  if (ts.isIdentifier(node)) return names.has(node.text) && isReference(node)
  return isFactoryMember(node) || isTakenUnderAnotherName(node)
}

/** Every node that reads the factory as a value, an import or a type excluded. */
function factoryUseNodes(module: ModuleShape): readonly ts.Node[] {
  const names = factoryNames(module)
  const uses: ts.Node[] = []
  const visit = (node: ts.Node): void => {
    // An import binds the name and a type runs nothing: neither is a use.
    if (ts.isImportDeclaration(node) || ts.isTypeNode(node)) return
    if (ts.isExportSpecifier(node)) {
      if (leavesUnderAnotherName(names, node)) uses.push(node)
      return
    }
    if (isFactoryUse(names, node)) uses.push(node)
    ts.forEachChild(node, visit)
  }
  visit(module.sourceFile)
  return uses
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

/**
 * The name a call is recorded under: the one its module exports, so an aliased
 * import of the policy is still the policy. A name spelled like the policy that
 * is not imported from the policy's module is something else, and is recorded
 * under no name.
 */
function recordedCall(module: ModuleShape, name: string): string | null {
  const imported = module.imports.get(name)
  const exported = imported?.name ?? name
  if (exported !== EXECUTION_POLICY) return exported
  return imported?.specifier === EXECUTION_POLICY_MODULE ? exported : null
}

function followNode(walk: Walk, module: ModuleShape, node: ts.Node): void {
  const { referenced, called } = namesRead(node)
  for (const name of called) {
    const recorded = recordedCall(module, name)
    if (recorded !== null) walk.calls.add(recorded)
  }
  for (const name of referenced) followName(walk, module, name)
}

/** Every server function of one module, with the names its handler reaches. */
function serverFunctionReachesOf(
  file: string,
  read: SourceReader,
): readonly ServerFunctionReach[] {
  const modules = new Map<string, ModuleShape | null>()
  const text = read(file)
  if (text === null) return []
  const module = moduleShape(file, text)
  modules.set(file, module)

  const reaches: ServerFunctionReach[] = []
  for (const { name, node } of serverFunctionDeclarations(module)) {
    const walk: Walk = {
      read,
      modules,
      seen: new Set([`${file}#${name}`]),
      calls: new Set(),
    }
    followNode(walk, module, node)
    reaches.push({ file, name, calls: walk.calls })
  }
  return reaches
}

/** Every use of the factory in one module, in source order. */
function serverFunctionFactoryUsesOf(
  file: string,
  read: SourceReader,
): readonly ServerFunctionFactoryUse[] {
  const text = read(file)
  if (text === null) return []
  const module = moduleShape(file, text)
  const declaredAt = new Map(
    serverFunctionDeclarations(module).map(({ name, factory }) => [factory, name]),
  )
  return factoryUseNodes(module).map((node) => ({
    file,
    line:
      module.sourceFile.getLineAndCharacterOfPosition(node.getStart(module.sourceFile))
        .line + 1,
    declaredAs: declaredAt.get(node) ?? null,
  }))
}

/** True for a module that ships: not a test, a story or a declaration file. */
export function isProductionSource(file: string): boolean {
  return SOURCE_FILE.test(file) && !NOT_PRODUCTION.test(file)
}

/**
 * The modules worth parsing. Every form this module reads spells the factory's
 * name somewhere in the file (an alias in its import, a member in its access),
 * so a file without the word holds nothing a parse would find.
 */
function modulesNamingTheFactory(
  files: readonly string[],
  read: SourceReader,
): readonly string[] {
  return files
    .filter((file) => read(file)?.includes(SERVER_FUNCTION_FACTORY) === true)
    .sort()
}

/** Every server function of the given modules, with what each handler reaches. */
export function serverFunctionReaches(
  files: readonly string[],
  read: SourceReader,
): readonly ServerFunctionReach[] {
  return modulesNamingTheFactory(files, read).flatMap((file) =>
    serverFunctionReachesOf(file, read),
  )
}

/** Every use of the factory in the given modules. */
export function serverFunctionFactoryUses(
  files: readonly string[],
  read: SourceReader,
): readonly ServerFunctionFactoryUse[] {
  return modulesNamingTheFactory(files, read).flatMap((file) =>
    serverFunctionFactoryUsesOf(file, read),
  )
}
