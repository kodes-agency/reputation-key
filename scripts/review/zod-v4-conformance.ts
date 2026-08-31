import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
])
const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.output',
  '.pnpm-store',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'storybook-static',
  'test-results',
])

const DEPRECATED_STRING_FORMATS = new Set([
  'base64',
  'cidr',
  'cuid',
  'cuid2',
  'date',
  'datetime',
  'duration',
  'email',
  'emoji',
  'ip',
  'jwt',
  'nanoid',
  'time',
  'ulid',
  'url',
  'uuid',
])

export type ZodV4ConformanceViolation = Readonly<{
  column: number
  kind: 'deprecated-string-format' | 'mixed-import'
  line: number
  message: string
}>

function sourceLocation(sourceFile: ts.SourceFile, node: ts.Node) {
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return {
    column: location.character + 1,
    line: location.line + 1,
  }
}

function isZodModule(moduleName: string): boolean {
  return moduleName === 'zod' || moduleName.startsWith('zod/')
}

/**
 * The zod-family specifier of a statement that re-exports or `import =`s zod.
 * These forms introduce no local `z` binding, so they only need pin checking.
 */
function zodReExportSpecifier(statement: ts.Statement): ts.StringLiteral | undefined {
  if (ts.isExportDeclaration(statement)) {
    const specifier = statement.moduleSpecifier
    return specifier && ts.isStringLiteral(specifier) && isZodModule(specifier.text)
      ? specifier
      : undefined
  }
  if (
    ts.isImportEqualsDeclaration(statement) &&
    ts.isExternalModuleReference(statement.moduleReference) &&
    statement.moduleReference.expression &&
    ts.isStringLiteral(statement.moduleReference.expression) &&
    isZodModule(statement.moduleReference.expression.text)
  ) {
    return statement.moduleReference.expression
  }
  return undefined
}

type ZodImport = Readonly<{
  specifier: ts.StringLiteral
  clause: ts.ImportClause | undefined
}>

/** The zod-family specifier and clause of a top-level `import ... from 'zod...'`. */
function zodImport(statement: ts.Statement): ZodImport | undefined {
  if (!ts.isImportDeclaration(statement)) return undefined
  const specifier = statement.moduleSpecifier
  return ts.isStringLiteral(specifier) && isZodModule(specifier.text)
    ? { specifier, clause: statement.importClause }
    : undefined
}

/** Records every local name that can stand for the zod namespace or its `z` export. */
function collectZodBindings(
  clause: ts.ImportClause | undefined,
  into: Set<string>,
): void {
  if (!clause) return
  if (clause.name) into.add(clause.name.text)
  const named = clause.namedBindings
  if (named && ts.isNamespaceImport(named)) {
    into.add(named.name.text)
    return
  }
  if (!named || !ts.isNamedImports(named)) return
  for (const element of named.elements) {
    if ((element.propertyName ?? element.name).text === 'z') into.add(element.name.text)
  }
}

/** The zod-family specifier of a dynamic `import()` or `require()` call. */
function dynamicZodModuleSpecifier(node: ts.Node): ts.StringLiteral | undefined {
  if (!ts.isCallExpression(node)) return undefined
  const isModuleLoad =
    node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(node.expression) && node.expression.text === 'require')
  if (!isModuleLoad || node.arguments.length !== 1) return undefined
  const argument = node.arguments[0]!
  return ts.isStringLiteral(argument) && isZodModule(argument.text) ? argument : undefined
}

/** The deprecated format name of a `<zod>.string().<format>()` chain, if any. */
function deprecatedStringFormat(
  node: ts.Node,
  zodBindings: ReadonlySet<string>,
): string | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return undefined
  }
  const format = node.expression.name.text
  const stringCall = node.expression.expression
  if (
    !DEPRECATED_STRING_FORMATS.has(format) ||
    !ts.isCallExpression(stringCall) ||
    !ts.isPropertyAccessExpression(stringCall.expression) ||
    stringCall.expression.name.text !== 'string' ||
    !ts.isIdentifier(stringCall.expression.expression) ||
    !zodBindings.has(stringCall.expression.expression.text)
  ) {
    return undefined
  }
  return format
}

function deprecatedFormatMessage(format: string): string {
  return format === 'datetime'
    ? 'Use z.iso.datetime(); the chained string datetime format is deprecated.'
    : `Use z.${format}() instead of the deprecated chained string format.`
}

export function findZodV4ConformanceViolations(
  source: string,
  fileName = 'fixture.ts',
): readonly ZodV4ConformanceViolation[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const violations: ZodV4ConformanceViolation[] = []
  const zodBindings = new Set<string>()

  const recordUnlessPinned = (specifier: ts.StringLiteralLike): void => {
    if (specifier.text === 'zod/v4') return
    violations.push({
      ...sourceLocation(sourceFile, specifier),
      kind: 'mixed-import',
      message: "Import the pinned API explicitly from 'zod/v4'.",
    })
  }

  for (const statement of sourceFile.statements) {
    const reExported = zodReExportSpecifier(statement)
    if (reExported) {
      recordUnlessPinned(reExported)
      continue
    }
    const imported = zodImport(statement)
    if (!imported) continue
    recordUnlessPinned(imported.specifier)
    collectZodBindings(imported.clause, zodBindings)
  }

  const visit = (node: ts.Node): void => {
    const dynamic = dynamicZodModuleSpecifier(node)
    if (dynamic) recordUnlessPinned(dynamic)
    const format = deprecatedStringFormat(node, zodBindings)
    if (format !== undefined) {
      violations.push({
        ...sourceLocation(sourceFile, node),
        kind: 'deprecated-string-format',
        message: deprecatedFormatMessage(format),
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  return violations.sort((left, right) =>
    left.line === right.line ? left.column - right.column : left.line - right.line,
  )
}

function collectSourceFiles(directory: string): readonly string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry.name) || entry.name.startsWith('dist-')) continue
      files.push(...collectSourceFiles(path))
    } else if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
      files.push(path)
    }
  }
  return files
}

export function checkZodV4Conformance(repositoryRoot: string): readonly string[] {
  const failures: string[] = []
  for (const path of collectSourceFiles(repositoryRoot)) {
    const source = readFileSync(path, 'utf8')
    for (const violation of findZodV4ConformanceViolations(source, path)) {
      failures.push(
        `${relative(repositoryRoot, path)}:${violation.line}:${violation.column} ${violation.message}`,
      )
    }
  }
  return failures.sort()
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectExecution) {
  const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
  const failures = checkZodV4Conformance(repositoryRoot)
  if (failures.length > 0) {
    console.error('Zod v4 conformance violations:')
    for (const failure of failures) console.error(`  ${failure}`)
    console.error(`\nTotal: ${failures.length} violation(s).`)
    process.exitCode = 1
  } else {
    console.log('Zod v4 conformance OK — explicit imports and current format APIs only.')
  }
}
