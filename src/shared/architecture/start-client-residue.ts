// What the browser still loads of a module the TanStack Start compiler rewrites.
//
// For the client build the compiler (@tanstack/start-plugin-core,
// start-compiler/) removes the server halves of four constructs:
//   - `createServerFn(...)`: the `.handler(...)` argument becomes an RPC stub,
//     `.validator(...)` and `.inputValidator(...)` are dropped;
//   - `createMiddleware(...)`: `.server(...)` and the validators are dropped;
//   - `createIsomorphicFn()`: only the `.client(...)` function is kept;
//   - `createServerOnlyFn(fn)`: replaced by a function that throws.
// It then removes the top-level declarations and imports nothing refers to any
// more. The rest stays: a plain export, a top-level statement, a re-export, and
// every import they reach. A plain export that uses a Node builtin therefore
// keeps the builtin in the client bundle and breaks hydration (root CONTEXT.md,
// "Client/Server Boundary"). The browser-reachability canary walks this residue
// instead of treating the whole module as invisible.
//
// Names are matched by spelling, not by scope: a local that shadows an import
// keeps the import. That errs towards reporting.

import ts from 'typescript'
import { calleeName, isReference, methodName } from './source-syntax'

/** Factory → the chain methods whose arguments never reach the client. */
const SERVER_ONLY_METHODS: Readonly<Record<string, ReadonlySet<string>>> = {
  createServerFn: new Set(['handler', 'validator', 'inputValidator']),
  createMiddleware: new Set(['server', 'validator', 'inputValidator']),
  createIsomorphicFn: new Set(['server']),
}
const SERVER_ONLY_FACTORY = 'createServerOnlyFn'

/** The spellings that make the compiler rewrite a module for the client. */
export const START_COMPILED = [
  ...Object.keys(SERVER_ONLY_METHODS),
  SERVER_ONLY_FACTORY,
] as const

export type ClientResidue = Readonly<{
  /** Import and re-export specifiers the client module still loads. */
  specifiers: readonly string[]
  /** The source with everything the client build drops blanked out. */
  code: string
}>

type Span = Readonly<{ start: number; end: number }>

type ModuleShape = Readonly<{
  /** Local binding → the specifier it is imported from. */
  imports: ReadonlyMap<string, string>
  /** Specifiers that stay whatever is referenced: side-effect imports and re-exports. */
  unconditional: readonly string[]
  /** Top-level name → the statement that declares it. */
  declarations: ReadonlyMap<string, ts.Statement>
  /** Statements the client keeps for their own sake: exports and side effects. */
  roots: readonly ts.Statement[]
}>

/** `createServerFn` in `createServerFn({ method }).validator(schema).handler(fn)`. */
function chainFactory(call: ts.CallExpression): string | null {
  let current: ts.Expression = call
  while (
    ts.isCallExpression(current) &&
    ts.isPropertyAccessExpression(current.expression)
  ) {
    current = current.expression.expression
  }
  return ts.isCallExpression(current) ? calleeName(current) : null
}

/** True when the client build drops the arguments of this call. */
function dropsArguments(call: ts.CallExpression): boolean {
  if (calleeName(call) === SERVER_ONLY_FACTORY) return true
  const method = methodName(call)
  if (method === null) return false
  return SERVER_ONLY_METHODS[chainFactory(call) ?? '']?.has(method) === true
}

/** The argument spans the client build replaces with a stub or drops. */
function stubbedSpans(sourceFile: ts.SourceFile): readonly Span[] {
  const spans: Span[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && dropsArguments(node)) {
      for (const argument of node.arguments) {
        spans.push({ start: argument.getStart(sourceFile), end: argument.end })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return spans
}

function bindingNames(name: ts.BindingName): readonly string[] {
  if (ts.isIdentifier(name)) return [name.text]
  return name.elements.flatMap((element) =>
    ts.isBindingElement(element) ? bindingNames(element.name) : [],
  )
}

function declaredNames(statement: ts.Statement): readonly string[] {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((declaration) =>
      bindingNames(declaration.name),
    )
  }
  if (
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isEnumDeclaration(statement)
  ) {
    return statement.name === undefined ? [] : [statement.name.text]
  }
  return []
}

function isExported(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  )
}

function isTypeOnlyExport(statement: ts.ExportDeclaration): boolean {
  const clause = statement.exportClause
  if (statement.isTypeOnly) return true
  return (
    clause !== undefined &&
    ts.isNamedExports(clause) &&
    clause.elements.length > 0 &&
    clause.elements.every((element) => element.isTypeOnly)
  )
}

function specifierOf(statement: ts.ImportDeclaration | ts.ExportDeclaration): string {
  const specifier = statement.moduleSpecifier
  return specifier !== undefined && ts.isStringLiteral(specifier) ? specifier.text : ''
}

/** The local bindings an import declaration creates at runtime. */
function runtimeImportBindings(statement: ts.ImportDeclaration): readonly string[] {
  const clause = statement.importClause
  if (clause === undefined || clause.isTypeOnly) return []
  const names = clause.name === undefined ? [] : [clause.name.text]
  const bindings = clause.namedBindings
  if (bindings === undefined) return names
  if (ts.isNamespaceImport(bindings)) return [...names, bindings.name.text]
  return [
    ...names,
    ...bindings.elements
      .filter((element) => !element.isTypeOnly)
      .map((element) => element.name.text),
  ]
}

function isRuntimeReExport(statement: ts.Statement): statement is ts.ExportDeclaration {
  return (
    ts.isExportDeclaration(statement) &&
    statement.moduleSpecifier !== undefined &&
    !isTypeOnlyExport(statement)
  )
}

/** A statement of the module's own that exists at runtime: not an import, a re-export or a type. */
function isLocalRuntimeStatement(statement: ts.Statement): boolean {
  if (ts.isImportDeclaration(statement)) return false
  if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
    return false
  }
  if (!ts.isExportDeclaration(statement)) return true
  return statement.moduleSpecifier === undefined && !isTypeOnlyExport(statement)
}

function moduleShape(sourceFile: ts.SourceFile): ModuleShape {
  const importDeclarations = sourceFile.statements.filter(ts.isImportDeclaration)
  const local = sourceFile.statements.filter(isLocalRuntimeStatement)
  return {
    imports: new Map(
      importDeclarations.flatMap((statement) =>
        runtimeImportBindings(statement).map(
          (name) => [name, specifierOf(statement)] as const,
        ),
      ),
    ),
    unconditional: [
      // `import './x'` runs for its side effects, so it stays.
      ...importDeclarations
        .filter((statement) => statement.importClause === undefined)
        .map(specifierOf),
      ...sourceFile.statements.filter(isRuntimeReExport).map(specifierOf),
    ],
    declarations: new Map(
      local.flatMap((statement) =>
        declaredNames(statement).map((name) => [name, statement] as const),
      ),
    ),
    roots: local.filter(
      (statement) => declaredNames(statement).length === 0 || isExported(statement),
    ),
  }
}

function isInside(
  node: ts.Node,
  spans: readonly Span[],
  sourceFile: ts.SourceFile,
): boolean {
  const start = node.getStart(sourceFile)
  return spans.some((span) => start >= span.start && node.end <= span.end)
}

/** The names a statement reads once its stubbed arguments are gone. */
function referencedNames(
  statement: ts.Statement,
  stubbed: readonly Span[],
  sourceFile: ts.SourceFile,
): ReadonlySet<string> {
  const names = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node) || isInside(node, stubbed, sourceFile)) return
    if (ts.isExportSpecifier(node)) {
      names.add((node.propertyName ?? node.name).text)
      return
    }
    if (ts.isIdentifier(node) && isReference(node)) names.add(node.text)
    ts.forEachChild(node, visit)
  }
  visit(statement)
  return names
}

/** `source` with each span replaced by a space; overlapping spans are merged. */
function blank(source: string, spans: readonly Span[]): string {
  let kept = ''
  let cursor = 0
  for (const span of [...spans].sort((left, right) => left.start - right.start)) {
    if (span.start < cursor) continue
    kept += `${source.slice(cursor, span.start)} `
    cursor = span.end
  }
  return kept + source.slice(cursor)
}

export function clientResidue(fileName: string, source: string): ClientResidue {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const shape = moduleShape(sourceFile)
  const stubbed = stubbedSpans(sourceFile)
  const specifiers = new Set(shape.unconditional)
  const kept = new Set<ts.Statement>()
  const pending = [...shape.roots]

  for (let statement = pending.pop(); statement; statement = pending.pop()) {
    if (kept.has(statement)) continue
    kept.add(statement)
    for (const name of referencedNames(statement, stubbed, sourceFile)) {
      const specifier = shape.imports.get(name)
      if (specifier !== undefined) specifiers.add(specifier)
      const declaration = shape.declarations.get(name)
      if (declaration !== undefined) pending.push(declaration)
    }
  }

  const dropped = sourceFile.statements
    .filter((statement) => !kept.has(statement))
    .map((statement) => ({ start: statement.getStart(sourceFile), end: statement.end }))
  return {
    specifiers: [...specifiers],
    code: blank(source, [...stubbed, ...dropped]),
  }
}
