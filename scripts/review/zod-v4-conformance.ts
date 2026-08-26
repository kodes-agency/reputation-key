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

  function recordMixedImport(moduleSpecifier: ts.StringLiteralLike) {
    violations.push({
      ...sourceLocation(sourceFile, moduleSpecifier),
      kind: 'mixed-import',
      message: "Import the pinned API explicitly from 'zod/v4'.",
    })
  }

  function isZodModule(moduleName: string) {
    return moduleName === 'zod' || moduleName.startsWith('zod/')
  }

  for (const statement of sourceFile.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      isZodModule(statement.moduleSpecifier.text) &&
      statement.moduleSpecifier.text !== 'zod/v4'
    ) {
      recordMixedImport(statement.moduleSpecifier)
      continue
    }
    if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      statement.moduleReference.expression &&
      ts.isStringLiteral(statement.moduleReference.expression) &&
      isZodModule(statement.moduleReference.expression.text) &&
      statement.moduleReference.expression.text !== 'zod/v4'
    ) {
      recordMixedImport(statement.moduleReference.expression)
      continue
    }
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !isZodModule(statement.moduleSpecifier.text)
    ) {
      continue
    }
    const moduleName = statement.moduleSpecifier.text
    if (moduleName !== 'zod/v4') recordMixedImport(statement.moduleSpecifier)

    const clause = statement.importClause
    if (!clause) continue
    if (clause.name) zodBindings.add(clause.name.text)
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      zodBindings.add(clause.namedBindings.name.text)
    } else if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if ((element.propertyName ?? element.name).text === 'z') {
          zodBindings.add(element.name.text)
        }
      }
    }
  }

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      isZodModule(node.arguments[0].text) &&
      node.arguments[0].text !== 'zod/v4'
    ) {
      recordMixedImport(node.arguments[0])
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const format = node.expression.name.text
      const stringCall = node.expression.expression
      if (
        DEPRECATED_STRING_FORMATS.has(format) &&
        ts.isCallExpression(stringCall) &&
        ts.isPropertyAccessExpression(stringCall.expression) &&
        stringCall.expression.name.text === 'string' &&
        ts.isIdentifier(stringCall.expression.expression) &&
        zodBindings.has(stringCall.expression.expression.text)
      ) {
        violations.push({
          ...sourceLocation(sourceFile, node),
          kind: 'deprecated-string-format',
          message:
            format === 'datetime'
              ? 'Use z.iso.datetime(); the chained string datetime format is deprecated.'
              : `Use z.${format}() instead of the deprecated chained string format.`,
        })
      }
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
