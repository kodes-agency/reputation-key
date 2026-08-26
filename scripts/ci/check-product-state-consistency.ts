import { readFileSync, readdirSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

export type ProductStateSource = Readonly<{
  path: string
  content: string
}>

export type ProductStateClassification =
  | 'server_draft'
  | 'server_snapshot'
  | 'synchronized_prop_copy'
  | 'client_persistence'
  | 'local_runtime'

export type ProductStateLedger = Readonly<{
  version: 1
  scope: readonly ['src/components', 'src/routes'] | readonly string[]
  broadInvalidationExceptions: readonly Readonly<{
    id: string
    owner: string
    rationale: string
  }>[]
  stateMirrorCandidates: readonly Readonly<{
    id: string
    classification: ProductStateClassification
    owner: string
    policy: string
  }>[]
  classificationDefinitions: Readonly<Record<ProductStateClassification, string>>
  limitations: readonly string[]
}>

export type ProductStateSite = Readonly<{
  id: string
  path: string
  line: number
}>

export type ProductStateAuditReport = Readonly<{
  queryKeySites: readonly ProductStateSite[]
  broadInvalidationSites: readonly ProductStateSite[]
  stateMirrorCandidates: readonly ProductStateSite[]
  violations: readonly string[]
}>

const PRODUCTION_SOURCE = /\.(?:ts|tsx)$/u
const NON_PRODUCTION_SOURCE = /\.(?:test|stories)\.(?:ts|tsx)$/u

function collectProductionSources(root: string, directory: string): ProductStateSource[] {
  const sources: ProductStateSource[] = []
  const absoluteDirectory = resolve(root, directory)
  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const absolutePath = resolve(absoluteDirectory, entry.name)
    const workspacePath = relative(root, absolutePath).replaceAll('\\', '/')
    if (entry.isDirectory()) {
      sources.push(...collectProductionSources(root, workspacePath))
    } else if (
      entry.isFile() &&
      PRODUCTION_SOURCE.test(entry.name) &&
      !NON_PRODUCTION_SOURCE.test(entry.name)
    ) {
      sources.push({
        path: workspacePath,
        content: readFileSync(absolutePath, 'utf8'),
      })
    }
  }
  return sources
}

export function loadProductStateLedger(root: string): ProductStateLedger {
  return JSON.parse(
    readFileSync(
      resolve(root, 'scripts/ci/product-state-consistency-ledger.json'),
      'utf8',
    ),
  ) as ProductStateLedger
}

export function auditRepositoryProductState(root: string): ProductStateAuditReport {
  const ledger = loadProductStateLedger(root)
  const sources = ledger.scope
    .flatMap((directory) => collectProductionSources(root, directory))
    .sort((left, right) => left.path.localeCompare(right.path))
  return auditProductStateSources(sources, ledger)
}

function sourceFileFor(source: ProductStateSource): ts.SourceFile {
  return ts.createSourceFile(
    source.path,
    source.content,
    ts.ScriptTarget.Latest,
    true,
    source.path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function isUseStateCall(node: ts.CallExpression): boolean {
  return (
    (ts.isIdentifier(node.expression) && node.expression.text === 'useState') ||
    (ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'useState')
  )
}

function isStateMirrorCandidateInitializer(node: ts.Expression): boolean {
  if (
    ts.isStringLiteralLike(node) ||
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(node) && node.text === 'undefined') ||
    (ts.isArrayLiteralExpression(node) && node.elements.length === 0) ||
    (ts.isObjectLiteralExpression(node) && node.properties.length === 0)
  ) {
    return false
  }
  return true
}

function stateBindingName(node: ts.CallExpression): string | undefined {
  const declaration = node.parent
  if (!ts.isVariableDeclaration(declaration)) return undefined
  if (!ts.isArrayBindingPattern(declaration.name)) return undefined
  const first = declaration.name.elements[0]
  return first && ts.isBindingElement(first) && ts.isIdentifier(first.name)
    ? first.name.text
    : undefined
}

export function auditProductStateSources(
  sources: readonly ProductStateSource[],
  ledger: ProductStateLedger,
): ProductStateAuditReport {
  const queryKeySites: ProductStateSite[] = []
  const broadInvalidationSites: ProductStateSite[] = []
  const stateMirrorCandidates: ProductStateSite[] = []
  const violations: string[] = []
  const allowedBroadInvalidations = new Set(
    ledger.broadInvalidationExceptions.map(({ id }) => id),
  )
  const ownedStateCandidates = new Set(ledger.stateMirrorCandidates.map(({ id }) => id))

  for (const source of sources) {
    const sourceFile = sourceFileFor(source)
    let queryKeyOrdinal = 0
    let broadInvalidationOrdinal = 0
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && node.name.getText(sourceFile) === 'queryKey') {
        const line = lineOf(sourceFile, node)
        queryKeyOrdinal += 1
        queryKeySites.push({
          id: `${source.path}:queryKey#${queryKeyOrdinal}`,
          path: source.path,
          line,
        })
        if (ts.isArrayLiteralExpression(node.initializer)) {
          violations.push(
            `${source.path}:${line}: literal queryKey arrays must use a shared hierarchical factory`,
          )
        }
      }
      if (
        ts.isCallExpression(node) &&
        node.arguments.length === 0 &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'invalidate'
      ) {
        const line = lineOf(sourceFile, node)
        broadInvalidationOrdinal += 1
        const site = {
          id: `${source.path}:router.invalidate#${broadInvalidationOrdinal}`,
          path: source.path,
          line,
        }
        broadInvalidationSites.push(site)
        if (!allowedBroadInvalidations.has(site.id)) {
          violations.push(
            `${source.path}:${line}: broad router.invalidate() has no owned exception`,
          )
        }
      }
      if (
        ts.isCallExpression(node) &&
        isUseStateCall(node) &&
        node.arguments[0] &&
        isStateMirrorCandidateInitializer(node.arguments[0])
      ) {
        const binding = stateBindingName(node)
        if (binding) {
          const line = lineOf(sourceFile, node)
          const site = {
            id: `${source.path}:useState(${binding})`,
            path: source.path,
            line,
          }
          stateMirrorCandidates.push(site)
          if (!ownedStateCandidates.has(site.id)) {
            violations.push(
              `${source.path}:${line}: state-mirror candidate useState(${binding}) has no owned classification`,
            )
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }

  const broadSiteIds = new Set(broadInvalidationSites.map(({ id }) => id))
  for (const exception of ledger.broadInvalidationExceptions) {
    if (!broadSiteIds.has(exception.id)) {
      violations.push(`stale broad-invalidation exception: ${exception.id}`)
    }
  }
  const stateCandidateIds = new Set(stateMirrorCandidates.map(({ id }) => id))
  for (const classification of ledger.stateMirrorCandidates) {
    if (!stateCandidateIds.has(classification.id)) {
      violations.push(`stale state-mirror classification: ${classification.id}`)
    }
  }

  return {
    queryKeySites,
    broadInvalidationSites,
    stateMirrorCandidates,
    violations,
  }
}

function main(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const ledger = loadProductStateLedger(root)
  const report = auditRepositoryProductState(root)
  if (process.argv.includes('--json')) {
    process.stdout.write(
      `${JSON.stringify({ ...report, limitations: ledger.limitations }, null, 2)}\n`,
    )
  } else {
    process.stdout.write(
      `Product-state slice: ${report.queryKeySites.length} query-key sites, ${report.broadInvalidationSites.length} broad invalidation, ${report.stateMirrorCandidates.length} state-mirror candidates.\n`,
    )
    for (const limitation of ledger.limitations) {
      process.stdout.write(`Limit: ${limitation}\n`)
    }
  }
  if (report.violations.length > 0) {
    for (const violation of report.violations) process.stderr.write(`${violation}\n`)
    process.exitCode = 1
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
