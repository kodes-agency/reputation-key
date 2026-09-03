import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { RAW_ROLE_DECISION_CATALOGUE } from './raw-role-decision-catalogue'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const BUILT_IN_ROLES = new Set(['AccountAdmin', 'PropertyManager', 'Staff'])

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) return []
    if (
      entry.name.endsWith('.test.ts') ||
      entry.name.endsWith('.test.tsx') ||
      entry.name.endsWith('.stories.tsx') ||
      entry.name === 'routeTree.gen.ts'
    ) {
      return []
    }
    return [path]
  })
}

function containsRoleReference(node: ts.Node): boolean {
  if (ts.isIdentifier(node) && /^(?:actorRole|role)$/u.test(node.text)) return true
  if (
    ts.isPropertyAccessExpression(node) &&
    (node.name.text === 'role' || node.name.text === 'actorRole')
  ) {
    return true
  }
  return node.getChildren().some(containsRoleReference)
}

function builtInRoleLiteral(node: ts.Node): string | null {
  return ts.isStringLiteral(node) && BUILT_IN_ROLES.has(node.text) ? node.text : null
}

function builtInRoleLiterals(node: ts.Node): readonly string[] {
  const values: string[] = []
  const visit = (candidate: ts.Node): void => {
    const value = builtInRoleLiteral(candidate)
    if (value !== null) values.push(value)
    ts.forEachChild(candidate, visit)
  }
  visit(node)
  return values
}

const ROLE_COMPARISON_TOKENS: readonly ts.SyntaxKind[] = [
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]

/** `role === 'admin'` / `'admin' !== role` equality decisions. */
function comparisonRoleDecisions(
  node: ts.Node,
  source: ts.SourceFile,
): readonly string[] {
  if (!ts.isBinaryExpression(node)) return []
  if (!ROLE_COMPARISON_TOKENS.includes(node.operatorToken.kind)) return []
  const leftRole = builtInRoleLiteral(node.left)
  const rightRole = builtInRoleLiteral(node.right)
  const compares =
    (leftRole !== null && containsRoleReference(node.right)) ||
    (rightRole !== null && containsRoleReference(node.left))
  if (!compares) return []
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
  return [`${line + 1}:${leftRole ?? rightRole}`]
}

/** `[...].includes(role)` / `set.has(role)` membership decisions. */
function membershipRoleDecisions(
  node: ts.Node,
  source: ts.SourceFile,
): readonly string[] {
  if (!ts.isCallExpression(node)) return []
  if (!ts.isPropertyAccessExpression(node.expression)) return []
  const accessed = node.expression
  if (accessed.name.text !== 'includes' && accessed.name.text !== 'has') return []
  if (!node.arguments.some(containsRoleReference)) return []
  const roles = builtInRoleLiterals(accessed.expression)
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
  return roles.map((role) => `${line + 1}:${role}`)
}

/** `switch (role) { case 'admin': ... }` decisions, one per case clause. */
function switchRoleDecisions(node: ts.Node, source: ts.SourceFile): readonly string[] {
  if (!ts.isSwitchStatement(node)) return []
  if (!containsRoleReference(node.expression)) return []
  const decisions: string[] = []
  for (const clause of node.caseBlock.clauses) {
    if (!ts.isCaseClause(clause)) continue
    const role = builtInRoleLiteral(clause.expression)
    if (role === null) continue
    const { line } = source.getLineAndCharacterOfPosition(clause.getStart(source))
    decisions.push(`${line + 1}:${role}`)
  }
  return decisions
}

function discoverRawRoleDecisions(body: string, fileName: string): readonly string[] {
  const source = ts.createSourceFile(
    fileName,
    body,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const decisions: string[] = []
  const visit = (node: ts.Node): void => {
    decisions.push(
      ...comparisonRoleDecisions(node, source),
      ...membershipRoleDecisions(node, source),
      ...switchRoleDecisions(node, source),
    )
    ts.forEachChild(node, visit)
  }
  visit(source)
  return decisions
}

describe('raw built-in-role decision catalogue', () => {
  it('classifies every production decision and rejects stale catalogue rows', () => {
    const discovered = sourceFiles(SRC)
      .map((path) => ({
        path: relative(ROOT, path),
        decisions: discoverRawRoleDecisions(readFileSync(path, 'utf8'), path),
      }))
      .filter(({ decisions }) => decisions.length > 0)
    const discoveredPaths = discovered.map(({ path }) => path).sort()
    const governedPaths = RAW_ROLE_DECISION_CATALOGUE.map(({ path }) => path).sort()

    expect(governedPaths).toEqual(discoveredPaths)
    expect(new Set(governedPaths).size).toBe(governedPaths.length)
  })

  it('confines retained decisions to product vocabulary or presentation', () => {
    for (const row of RAW_ROLE_DECISION_CATALOGUE) {
      if (row.disposition === 'central_product_vocabulary') {
        expect([
          'src/shared/domain/beta-interactive-role.ts',
          'src/shared/domain/roles.ts',
        ]).toContain(row.path)
      } else {
        expect(row.path).toMatch(/^src\/components\//u)
      }
      expect(row.authority.trim().length).toBeGreaterThan(0)
    }
  })

  it('keeps the legacy-dark decision catalogue empty after Team contraction', () => {
    // Deleting Team's membership use cases removed the final legacy-dark row.
    const legacyDarkRows = RAW_ROLE_DECISION_CATALOGUE.filter(
      (row) => 'capability' in row,
    )

    expect(legacyDarkRows).toEqual([])
  })

  it('keeps the contracted Leaderboard and Team builds inert', () => {
    const leaderboardBuild = readFileSync(
      join(ROOT, 'src/contexts/leaderboard/build.ts'),
      'utf8',
    )
    const composition = readFileSync(join(ROOT, 'src/composition.ts'), 'utf8')
    const teamBuild = readFileSync(join(ROOT, 'src/contexts/team/build.ts'), 'utf8')

    expect(leaderboardBuild).toContain('publicApi: {}')
    expect(leaderboardBuild).toContain('useCases: {}')
    expect(composition).not.toContain('buildLeaderboardContext')
    expect(teamBuild).toContain('publicApi: {}')
    expect(teamBuild).toContain('useCases: {}')
    expect(composition).not.toContain('buildTeamContext')

    expect(
      sourceFiles(SRC)
        .filter((path) =>
          readFileSync(path, 'utf8').includes("use-cases/team-memberships'"),
        )
        .map((path) => relative(ROOT, path)),
    ).toEqual([])
  })

  it('detects executable comparisons but ignores comments and unrelated state', () => {
    expect(
      discoverRawRoleDecisions(
        `
          // actor.role === 'AccountAdmin'
          if (item.status === 'Staff') return
          if (actor.role === 'PropertyManager') return
          if ('Staff' !== role) return
          if (['AccountAdmin'].includes(actor.role)) return
          switch (role) { case 'Staff': return }
        `,
        'fixture.ts',
      ),
    ).toEqual(['4:PropertyManager', '5:Staff', '6:AccountAdmin', '7:Staff'])
  })
})
