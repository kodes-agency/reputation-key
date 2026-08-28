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
  version: 2
  scope: readonly ['src/components', 'src/routes'] | readonly string[]
  queryKeyFactories: readonly Readonly<{
    id: string
    members: readonly string[]
    owner: string
    policy: string
  }>[]
  queryKeyDelegates: readonly Readonly<{
    id: string
    owner: string
    policy: string
  }>[]
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
  queryKeyFactoryMembers: readonly ProductStateSite[]
  mutationInvalidationSites: readonly ProductStateSite[]
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
  const productState = auditProductStateSources(sources, ledger)
  const queryKeyFactories = auditQueryKeyFactorySource(
    {
      path: 'src/shared/queries/query-keys.ts',
      content: readFileSync(resolve(root, 'src/shared/queries/query-keys.ts'), 'utf8'),
    },
    ledger,
  )
  return {
    ...productState,
    queryKeyFactoryMembers: queryKeyFactories.queryKeyFactoryMembers,
    violations: [...productState.violations, ...queryKeyFactories.violations],
  }
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

function propertyName(node: ts.PropertyName, sourceFile: ts.SourceFile): string {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text
  return node.getText(sourceFile)
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function returnedExpression(expression: ts.Expression): ts.Expression | null {
  const unwrapped = unwrapExpression(expression)
  if (!ts.isArrowFunction(unwrapped) && !ts.isFunctionExpression(unwrapped)) {
    return null
  }
  if (!ts.isBlock(unwrapped.body)) return unwrapExpression(unwrapped.body)
  const returns = unwrapped.body.statements.filter(ts.isReturnStatement)
  if (returns.length !== 1 || !returns[0]?.expression) return null
  return unwrapExpression(returns[0].expression)
}

function factoryParent(
  expression: ts.Expression,
): Readonly<{ factory: string; member: string }> | null {
  const unwrapped = unwrapExpression(expression)
  const target = ts.isCallExpression(unwrapped)
    ? unwrapExpression(unwrapped.expression)
    : unwrapped
  if (!ts.isPropertyAccessExpression(target) || !ts.isIdentifier(target.expression)) {
    return null
  }
  return { factory: target.expression.text, member: target.name.text }
}

export function auditQueryKeyFactorySource(
  source: ProductStateSource,
  ledger: ProductStateLedger,
): Pick<ProductStateAuditReport, 'queryKeyFactoryMembers' | 'violations'> {
  const sourceFile = sourceFileFor(source)
  const queryKeyFactoryMembers: ProductStateSite[] = []
  const factoryMembers = new Map<string, Map<string, ts.ObjectLiteralElementLike>>()

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    if (!statement.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)) {
      continue
    }
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue
      const initializer = declaration.initializer
      if (!initializer || !ts.isObjectLiteralExpression(initializer)) continue
      const members = new Map<string, ts.ObjectLiteralElementLike>()
      for (const member of initializer.properties) {
        if (!member.name) continue
        const name = propertyName(member.name, sourceFile)
        members.set(name, member)
        queryKeyFactoryMembers.push({
          id: `${declaration.name.text}.${name}`,
          path: source.path,
          line: lineOf(sourceFile, member),
        })
      }
      factoryMembers.set(declaration.name.text, members)
    }
  }

  const policyIds = ledger.queryKeyFactories.flatMap((factory) =>
    factory.members.map((member) => `${factory.id}.${member}`),
  )
  const ownedPolicyIds = new Set(policyIds)
  const sourceIds = new Set(queryKeyFactoryMembers.map(({ id }) => id))
  const violations = queryKeyFactoryMembers
    .filter(({ id }) => !ownedPolicyIds.has(id))
    .map(({ id }) => `unowned query-key factory member: ${id}`)

  for (const policyId of policyIds) {
    if (!sourceIds.has(policyId)) {
      violations.push(`stale query-key factory policy: ${policyId}`)
    }
  }
  for (const policyId of new Set(policyIds)) {
    if (policyIds.filter((candidate) => candidate === policyId).length > 1) {
      violations.push(`duplicate query-key factory policy: ${policyId}`)
    }
  }
  for (const factory of ledger.queryKeyFactories) {
    if (!factory.owner.trim() || !factory.policy.trim()) {
      violations.push(`query-key factory policy lacks ownership detail: ${factory.id}`)
    }
  }

  const roots = new Map<string, string>()
  for (const [factory, members] of factoryMembers) {
    const root = members.get('all')
    const rootInitializer =
      root && ts.isPropertyAssignment(root) ? unwrapExpression(root.initializer) : null
    if (!rootInitializer || !ts.isArrayLiteralExpression(rootInitializer)) {
      violations.push(`query-key factory lacks a literal all root: ${factory}`)
    } else if (
      rootInitializer.elements.length !== 1 ||
      !ts.isStringLiteralLike(rootInitializer.elements[0]!)
    ) {
      violations.push(`query-key factory all root must be one string literal: ${factory}`)
    } else {
      const rootValue = rootInitializer.elements[0].text
      const existing = roots.get(rootValue)
      if (existing) {
        violations.push(
          `query-key factory root collision: ${existing}.all and ${factory}.all both use ${JSON.stringify(rootValue)}`,
        )
      } else {
        roots.set(rootValue, factory)
      }
    }

    const parents = new Map<string, string>()
    for (const [memberName, member] of members) {
      if (memberName === 'all') continue
      const result = ts.isPropertyAssignment(member)
        ? returnedExpression(member.initializer)
        : null
      if (!result || !ts.isArrayLiteralExpression(result)) {
        violations.push(
          `query-key factory member must return a hierarchical array: ${factory}.${memberName}`,
        )
        continue
      }
      const first = result.elements[0]
      const parent =
        first && ts.isSpreadElement(first) ? factoryParent(first.expression) : null
      if (!parent || parent.factory !== factory) {
        violations.push(
          `query-key factory member must begin with its own family prefix: ${factory}.${memberName}`,
        )
        continue
      }
      if (!members.has(parent.member)) {
        violations.push(
          `query-key factory member references an unknown parent: ${factory}.${memberName} -> ${factory}.${parent.member}`,
        )
        continue
      }
      parents.set(memberName, parent.member)
    }

    for (const memberName of parents.keys()) {
      const visited = new Set<string>()
      let current: string | undefined = memberName
      while (current !== 'all') {
        if (visited.has(current)) {
          violations.push(
            `query-key factory hierarchy is cyclic: ${factory}.${memberName}`,
          )
          break
        }
        visited.add(current)
        current = parents.get(current)
        if (!current) {
          violations.push(
            `query-key factory member does not reach its all root: ${factory}.${memberName}`,
          )
          break
        }
      }
    }
  }

  return { queryKeyFactoryMembers, violations }
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

function stateSetterName(node: ts.CallExpression): string | undefined {
  const declaration = node.parent
  if (!ts.isVariableDeclaration(declaration)) return undefined
  if (!ts.isArrayBindingPattern(declaration.name)) return undefined
  const second = declaration.name.elements[1]
  return second && ts.isBindingElement(second) && ts.isIdentifier(second.name)
    ? second.name.text
    : undefined
}

function isEffectCall(node: ts.CallExpression): boolean {
  return (
    (ts.isIdentifier(node.expression) && node.expression.text === 'useEffect') ||
    (ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'useEffect')
  )
}

function setterRunsInsideEffect(sourceFile: ts.SourceFile, setter: string): boolean {
  let found = false
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === setter
    ) {
      let ancestor: ts.Node | undefined = node.parent
      while (ancestor && ancestor !== sourceFile) {
        if (ts.isCallExpression(ancestor) && isEffectCall(ancestor)) {
          found = true
          return
        }
        ancestor = ancestor.parent
      }
    }
    if (!found) ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

function queryKeyInitializer(
  node: ts.PropertyAssignment | ts.ShorthandPropertyAssignment,
): ts.Expression {
  return ts.isPropertyAssignment(node)
    ? node.initializer
    : ts.factory.createIdentifier(node.name.text)
}

function variableInitializers(
  sourceFile: ts.SourceFile,
  name: string,
): readonly ts.Expression[] {
  const matches: ts.Expression[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      matches.push(node.initializer)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return matches
}

function expressionUsesOwnedQueryFactory(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  ownedMembers: ReadonlySet<string>,
  visitedBindings: ReadonlySet<string> = new Set(),
): boolean {
  const current = unwrapExpression(expression)
  if (
    ts.isPropertyAccessExpression(current) &&
    ts.isIdentifier(current.expression) &&
    ownedMembers.has(`${current.expression.text}.${current.name.text}`)
  ) {
    return true
  }
  if (ts.isIdentifier(current) && !visitedBindings.has(current.text)) {
    const initializers = variableInitializers(sourceFile, current.text)
    if (initializers.length === 1) {
      return expressionUsesOwnedQueryFactory(
        initializers[0]!,
        sourceFile,
        ownedMembers,
        new Set([...visitedBindings, current.text]),
      )
    }
  }
  let found = false
  ts.forEachChild(current, (child) => {
    if (
      !found &&
      ts.isExpression(child) &&
      expressionUsesOwnedQueryFactory(child, sourceFile, ownedMembers, visitedBindings)
    ) {
      found = true
    }
  })
  return found
}

function resolveArrayExpression(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  visitedBindings: ReadonlySet<string> = new Set(),
): ts.ArrayLiteralExpression | null {
  const current = unwrapExpression(expression)
  if (ts.isArrayLiteralExpression(current)) return current
  if (ts.isIdentifier(current) && !visitedBindings.has(current.text)) {
    const initializers = variableInitializers(sourceFile, current.text)
    if (initializers.length === 1) {
      return resolveArrayExpression(
        initializers[0]!,
        sourceFile,
        new Set([...visitedBindings, current.text]),
      )
    }
  }
  return null
}

export function auditProductStateSources(
  sources: readonly ProductStateSource[],
  ledger: ProductStateLedger,
): ProductStateAuditReport {
  const queryKeySites: ProductStateSite[] = []
  const mutationInvalidationSites: ProductStateSite[] = []
  const broadInvalidationSites: ProductStateSite[] = []
  const stateMirrorCandidates: ProductStateSite[] = []
  const violations: string[] = []
  const ownedQueryFactoryMembers = new Set(
    ledger.queryKeyFactories.flatMap((factory) =>
      factory.members.map((member) => `${factory.id}.${member}`),
    ),
  )
  const queryKeyDelegates = ledger.queryKeyDelegates ?? []
  const allowedQueryKeyDelegates = new Set(queryKeyDelegates.map(({ id }) => id))
  const allowedBroadInvalidations = new Set(
    ledger.broadInvalidationExceptions.map(({ id }) => id),
  )
  const stateCandidatePolicies = new Map(
    ledger.stateMirrorCandidates.map((candidate) => [candidate.id, candidate] as const),
  )
  const ownedStateCandidates = new Set(stateCandidatePolicies.keys())

  const statePolicyIds = ledger.stateMirrorCandidates.map(({ id }) => id)
  for (const candidate of ledger.stateMirrorCandidates) {
    if (!candidate.owner.trim() || !candidate.policy.trim()) {
      violations.push(
        `state-mirror classification lacks ownership detail: ${candidate.id}`,
      )
    }
  }
  for (const id of new Set(statePolicyIds)) {
    if (statePolicyIds.filter((candidate) => candidate === id).length > 1) {
      violations.push(`duplicate state-mirror classification: ${id}`)
    }
  }

  for (const source of sources) {
    const sourceFile = sourceFileFor(source)
    let queryKeyOrdinal = 0
    let mutationInvalidationOrdinal = 0
    let broadInvalidationOrdinal = 0
    const visit = (node: ts.Node): void => {
      const isQueryKeyProperty =
        (ts.isPropertyAssignment(node) && node.name.getText(sourceFile) === 'queryKey') ||
        (ts.isShorthandPropertyAssignment(node) && node.name.text === 'queryKey')
      if (isQueryKeyProperty) {
        const line = lineOf(sourceFile, node)
        queryKeyOrdinal += 1
        const site = {
          id: `${source.path}:queryKey#${queryKeyOrdinal}`,
          path: source.path,
          line,
        }
        queryKeySites.push(site)
        const isLiteralQueryKey =
          ts.isPropertyAssignment(node) && ts.isArrayLiteralExpression(node.initializer)
        if (isLiteralQueryKey) {
          violations.push(
            `${source.path}:${line}: literal queryKey arrays must use a shared hierarchical factory`,
          )
        }
        if (
          !isLiteralQueryKey &&
          !expressionUsesOwnedQueryFactory(
            queryKeyInitializer(node),
            sourceFile,
            ownedQueryFactoryMembers,
          ) &&
          !allowedQueryKeyDelegates.has(site.id)
        ) {
          violations.push(
            `${source.path}:${line}: queryKey is neither factory-owned nor an explicit generic delegate`,
          )
        }
      }
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText(sourceFile) === 'invalidateKeys'
      ) {
        mutationInvalidationOrdinal += 1
        const line = lineOf(sourceFile, node)
        const site = {
          id: `${source.path}:invalidateKeys#${mutationInvalidationOrdinal}`,
          path: source.path,
          line,
        }
        mutationInvalidationSites.push(site)
        const keys = resolveArrayExpression(node.initializer, sourceFile)
        if (!keys || keys.elements.length === 0) {
          violations.push(
            `${source.path}:${line}: invalidateKeys must be a non-empty statically resolvable array`,
          )
        } else {
          for (const element of keys.elements) {
            const expression = ts.isSpreadElement(element) ? element.expression : element
            if (
              !expressionUsesOwnedQueryFactory(
                expression,
                sourceFile,
                ownedQueryFactoryMembers,
              )
            ) {
              violations.push(
                `${source.path}:${line}: invalidateKeys contains a key without an owned shared factory`,
              )
            }
          }
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
          } else {
            const policy = stateCandidatePolicies.get(site.id)
            const setter = stateSetterName(node)
            if (
              policy?.classification === 'server_draft' &&
              setter &&
              setterRunsInsideEffect(sourceFile, setter)
            ) {
              violations.push(
                `${source.path}:${line}: server draft useState(${binding}) is overwritten from an effect; use an explicit remount/conflict boundary`,
              )
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }

  const broadSiteIds = new Set(broadInvalidationSites.map(({ id }) => id))
  const queryKeySiteIds = new Set(queryKeySites.map(({ id }) => id))
  for (const delegate of queryKeyDelegates) {
    if (!delegate.owner.trim() || !delegate.policy.trim()) {
      violations.push(`query-key delegate lacks ownership detail: ${delegate.id}`)
    }
    if (!queryKeySiteIds.has(delegate.id)) {
      violations.push(`stale query-key delegate: ${delegate.id}`)
    }
  }
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
    queryKeyFactoryMembers: [],
    mutationInvalidationSites,
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
      `Product-state slice: ${report.queryKeyFactoryMembers.length} owned query-key factory members, ${report.queryKeySites.length} query-key sites, ${report.mutationInvalidationSites.length} mutation invalidation sites, ${report.broadInvalidationSites.length} broad invalidation, ${report.stateMirrorCandidates.length} state-mirror candidates.\n`,
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
