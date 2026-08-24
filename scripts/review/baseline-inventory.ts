import ts from 'typescript'

export type ArtifactClass = 'generated' | 'production' | 'support' | 'test'

export type FunctionLikeSymbol = Readonly<{
  file: string
  kind: 'function' | 'function-variable' | 'method'
  line: number
  name: string
}>

export type EntryPoint = Readonly<{
  file: string
  kind:
    | 'api-route'
    | 'event-consumer'
    | 'job-schedule'
    | 'operator-command'
    | 'route'
    | 'server-function'
    | 'sidecar-entry'
  line: number
}>

export type FindingDisposition =
  | 'closed'
  | 'configuration-dependent'
  | 'confirmed'
  | 'inferred'
  | 'reproduced'
  | 'superseded'

export type FindingRegisterRow = Readonly<{
  disposition: FindingDisposition
  id: string
  priorEvidence: ReadonlyArray<string>
  revalidation: 'required_at_frozen_sha'
  severity: string
  sourceLine: number
  summary: string
  targetPackages: ReadonlyArray<string>
}>

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs')) {
    return ts.ScriptKind.JS
  }
  return ts.ScriptKind.TS
}

function sourceFile(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file))
}

function stringArgument(node: ts.Expression | undefined): string | undefined {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined
}

export function extractImports(file: string, source: string): ReadonlyArray<string> {
  const imports = new Set<string>()
  const parsed = sourceFile(file, source)

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = stringArgument(node.moduleSpecifier)
      if (specifier) imports.add(specifier)
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if (isDynamicImport || isRequire) {
        const specifier = stringArgument(node.arguments[0])
        if (specifier) imports.add(specifier)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(parsed)
  return [...imports].sort()
}

function nodeLine(parsed: ts.SourceFile, node: ts.Node): number {
  return parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1
}

export function extractFunctionLikeSymbols(
  file: string,
  source: string,
): ReadonlyArray<FunctionLikeSymbol> {
  const symbols: FunctionLikeSymbol[] = []
  const parsed = sourceFile(file, source)

  const visit = (node: ts.Node, owner?: string): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      symbols.push({
        file,
        kind: 'function',
        line: nodeLine(parsed, node),
        name: node.name.text,
      })
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      symbols.push({
        file,
        kind: 'function-variable',
        line: nodeLine(parsed, node),
        name: node.name.text,
      })
    } else if (ts.isClassDeclaration(node) && node.name) {
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name) {
          const methodName = member.name.getText(parsed)
          symbols.push({
            file,
            kind: 'method',
            line: nodeLine(parsed, member),
            name: `${node.name.text}.${methodName}`,
          })
        }
      }
      owner = node.name.text
    }

    ts.forEachChild(node, (child) => visit(child, owner))
  }

  visit(parsed)
  return symbols.sort(
    (left, right) => left.line - right.line || left.name.localeCompare(right.name),
  )
}

export function classifyArtifact(file: string): ArtifactClass {
  const normalized = file.replaceAll('\\', '/')
  if (
    normalized.includes('/generated/') ||
    normalized.includes('/drizzle/meta/') ||
    /(?:^|\/)routeTree\.gen\.[^/]+$/.test(normalized)
  ) {
    return 'generated'
  }
  if (
    /\.(?:test|spec|stories)\.[cm]?[jt]sx?$/.test(normalized) ||
    normalized.startsWith('e2e/') ||
    normalized.startsWith('test-fixtures/') ||
    normalized.includes('/__tests__/') ||
    normalized.includes('/testing/')
  ) {
    return 'test'
  }
  if (
    normalized.startsWith('scripts/') ||
    normalized.startsWith('docs/') ||
    normalized.startsWith('.github/') ||
    /(?:^|\/)(?:vite|vitest|playwright|eslint|drizzle|tsup)[^/]*\.[cm]?[jt]s$/.test(
      normalized,
    )
  ) {
    return 'support'
  }
  return 'production'
}

function firstLine(source: string, expression: RegExp): number {
  const match = expression.exec(source)
  if (!match?.index) return 1
  return source.slice(0, match.index).split('\n').length
}

export function discoverEntryPoints(
  file: string,
  source: string,
): ReadonlyArray<EntryPoint> {
  const normalized = file.replaceAll('\\', '/')
  const discovered = new Map<EntryPoint['kind'], number>()
  const add = (kind: EntryPoint['kind'], expression: RegExp): void => {
    if (expression.test(source)) discovered.set(kind, firstLine(source, expression))
  }

  if (normalized.startsWith('src/routes/')) {
    discovered.set('route', 1)
  }
  if (
    normalized.startsWith('src/routes/api/') ||
    /createAPIFileRoute\s*\(/.test(source)
  ) {
    add('api-route', /createAPIFileRoute\s*\(|createFileRoute\s*\(/)
  }
  add('server-function', /createServerFn\s*\(/)
  add(
    'event-consumer',
    /(?:\bregister[A-Za-z0-9]*EventHandlers\s*\(|\.(?:on|subscribe)\s*\(\s*['"`]|\bnew\s+Worker\s*\()/,
  )
  add(
    'job-schedule',
    /(?:upsertJobScheduler|registerSchedule|repeat\s*:|\bnew\s+(?:Queue|Worker|QueueEvents)\s*\()/,
  )
  if (/^scripts\/ops\/[A-Za-z0-9_.-]+\.[cm]?[jt]s$/.test(normalized)) {
    discovered.set('operator-command', 1)
  }
  if (
    /^services\/[^/]+\/(?:index|server|main)\.[cm]?[jt]s$/.test(normalized) ||
    /^src\/services\/[^/]+\/(?:index|server|main)\.[cm]?[jt]s$/.test(normalized)
  ) {
    discovered.set('sidecar-entry', 1)
  }

  return [...discovered.entries()]
    .map(([kind, line]) => ({ file, kind, line }))
    .sort((left, right) => left.kind.localeCompare(right.kind))
}

export function expandFindingExpression(expression: string): ReadonlyArray<string> {
  const normalized = expression.replaceAll('`', '').trim()
  const match = /^([A-Z]{2,5})-(\d{2})(?:(\/\d{2})*|\.\.(\d{2}))$/.exec(normalized)
  if (!match) return []

  const [, prefix, first, slashTail, rangeEnd] = match
  if (rangeEnd) {
    const start = Number(first)
    const end = Number(rangeEnd)
    if (end < start) return []
    return Array.from({ length: end - start + 1 }, (_, index) => {
      return `${prefix}-${String(start + index).padStart(2, '0')}`
    })
  }

  const rest = slashTail ? normalized.slice(normalized.indexOf('/') + 1).split('/') : []
  return [first, ...rest].map((number) => `${prefix}-${number}`)
}

function expressionsIn(cell: string): ReadonlyArray<string> {
  return (
    cell.replaceAll('`', '').match(/[A-Z]{2,5}-\d{2}(?:(?:\/\d{2})+|\.\.\d{2})?/g) ?? []
  )
}

function markdownCells(line: string): ReadonlyArray<string> {
  return line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim())
}

export function parseTraceabilityMap(
  plan: string,
): ReadonlyMap<string, ReadonlyArray<string>> {
  const result = new Map<string, ReadonlyArray<string>>()

  for (const line of plan.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue
    const cells = markdownCells(line)
    if (cells.length < 2) continue
    const findings = expressionsIn(cells[0]).flatMap(expandFindingExpression)
    const packages = [
      ...new Set(expressionsIn(cells[1]).flatMap(expandFindingExpression)),
    ].sort()
    for (const finding of findings) {
      result.set(finding, packages)
    }
  }

  return new Map(
    [...result.entries()].sort(([left], [right]) => left.localeCompare(right)),
  )
}

function evidenceCodes(cells: ReadonlyArray<string>): ReadonlyArray<string> {
  const codes = new Set<string>()
  for (const cell of cells) {
    const leading = /^([CRIPDU](?:\/[CRIPDU])*)\b/.exec(cell)?.[1]
    if (!leading) continue
    for (const code of leading.split('/')) codes.add(code)
  }
  return [...codes].sort()
}

function dispositionFrom(codes: ReadonlyArray<string>): FindingDisposition {
  if (codes.includes('R')) return 'reproduced'
  if (codes.includes('C')) return 'confirmed'
  if (codes.includes('D')) return 'configuration-dependent'
  return 'inferred'
}

function severityFrom(cells: ReadonlyArray<string>): string {
  const value = cells
    .map((cell) => cell.replaceAll('**', ''))
    .find((cell) => /^(?:Decision blocker|Gate blocker|High|Medium|Low)/i.test(cell))
  return value?.split('/')[0]?.trim() ?? 'Unclassified'
}

function summaryFrom(cells: ReadonlyArray<string>): string {
  const severityIndex = cells.findIndex((cell) =>
    /^(?:Decision blocker|Gate blocker|High|Medium|Low)/i.test(cell.replaceAll('**', '')),
  )
  const afterSeverity =
    severityIndex >= 0 ? cells.slice(severityIndex + 1) : cells.slice(1)
  const candidates = afterSeverity.filter((cell) => {
    const normalized = cell.replaceAll('**', '')
    return (
      cell.length > 0 &&
      !/^(?:Decision blocker|Gate blocker|High|Medium|Low)(?:\/.*)?$/i.test(normalized) &&
      !/^P[0-9]/.test(normalized) &&
      !/^(?:new|raw|unnumbered)$/i.test(normalized) &&
      !/^[CRIPDU](?:\/[CRIPDU])*(?:;.*)?$/.test(normalized)
    )
  })
  return candidates[0] ?? '(summary unavailable)'
}

export function parseFindingRegister(
  report: string,
  traceability: ReadonlyMap<string, ReadonlyArray<string>>,
): ReadonlyArray<FindingRegisterRow> {
  const byId = new Map<string, FindingRegisterRow>()

  report.split('\n').forEach((line, index) => {
    if (!line.trimStart().startsWith('|')) return
    const cells = markdownCells(line)
    const id = /^(?:AUTH|DEC|GATE|SEC|ARCH|GOV|EVT|DATA|UI|OPS)-\d{2}$/.test(
      cells[0] ?? '',
    )
      ? cells[0]
      : undefined
    if (!id || byId.has(id)) return
    const priorEvidence = evidenceCodes(cells)
    byId.set(id, {
      disposition: dispositionFrom(priorEvidence),
      id,
      priorEvidence,
      revalidation: 'required_at_frozen_sha',
      severity: severityFrom(cells),
      sourceLine: index + 1,
      summary: summaryFrom(cells),
      targetPackages: traceability.get(id) ?? [],
    })
  })

  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id))
}
