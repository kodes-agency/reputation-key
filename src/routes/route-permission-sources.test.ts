// One permission authority per page (review findings R1D-04, R1D-05).
//
// A route asks two questions about permissions. Its `beforeLoad` and `loader`
// run before any component and ask the static role table, `can(role, …)`. Its
// component asks `usePermissions()`, which prefers the permissions the server
// resolved for this member and only falls back to that table. Root CONTEXT.md
// ("Permission Patterns") assigns each API its place.
//
// Route components used to ask the table too, so on one page the profile form
// could be enabled from the table while the card beside it followed the
// resolved set. And two affordances were decided by role rank (`hasRole`) where
// the server enforces a permission. With the three built-in roles every answer
// agrees, which is why nothing failed; this reads the sources instead.
import { relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { readUiSources, type SourceFile } from '#/shared/testing/source-tree'

const ROUTES = readUiSources({ includeTs: true }).filter((file) =>
  file.path.startsWith('src/routes/'),
)

const pathOf = (file: SourceFile) => relative('src/routes', file.path)

const parse = (file: SourceFile) =>
  ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true)

function isCallTo(node: ts.Node, name: string): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === name
  )
}

/** The object a route file passes to `createFileRoute(path)({ ... })`, if it has one. */
function routeOptionsOf(source: ts.SourceFile): ts.Node | null {
  let found: ts.Node | null = null
  const visit = (node: ts.Node): void => {
    if (found) return
    if (ts.isCallExpression(node) && isCallTo(node.expression, 'createFileRoute')) {
      found = node.arguments[0] ?? null
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** Lines of a route file that ask the static role table outside the route's options. */
function staticChecksInComponents(file: SourceFile): number[] {
  const source = parse(file)
  const options = routeOptionsOf(source)
  const inOptions = (node: ts.Node) =>
    options !== null && node.pos >= options.pos && node.end <= options.end
  const lines: number[] = []
  const visit = (node: ts.Node): void => {
    // `can(role, permission)`: the hook's own `can` takes the permission alone.
    if (isCallTo(node, 'can') && node.arguments.length > 1 && !inOptions(node)) {
      lines.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return lines
}

const countOf = (file: SourceFile, pattern: RegExp) =>
  [...file.text.matchAll(pattern)].length

describe('route permission checks', () => {
  it('finds the route files it is meant to read', () => {
    expect(ROUTES.map(pathOf)).toContain('_authenticated.tsx')
    expect(ROUTES.some((file) => /\bcan\(role, '[\w.]+'\)/u.test(file.text))).toBe(true)
  })

  it('ask the static role table only in beforeLoad and loader: a component asks usePermissions()', () => {
    const offenders = ROUTES.filter((file) => file.path.endsWith('.tsx'))
      .map((file) => ({ file: pathOf(file), lines: staticChecksInComponents(file) }))
      .filter(({ lines }) => lines.length > 0)

    expect(offenders).toEqual([])
  })

  /**
   * `hasRole` compares rank. It is for a decision that is about rank: which
   * sidebar a role gets, which roles an inviter may hand out, whether the reader
   * is the last admin. What a person may do is a permission. Each use is listed
   * with what it decides; a new one is added here with its reason, or is a
   * permission check and belongs to `can` / `usePermissions()`.
   */
  const RANK_DECISIONS: Readonly<
    Record<string, Readonly<{ uses: number; decides: string }>>
  > = {
    '_authenticated.tsx': { uses: 1, decides: 'which sidebar the shell draws' },
    '_authenticated/settings/members.tsx': {
      uses: 1,
      decides: 'which roles an inviter may assign (at or below their own)',
    },
    '_authenticated/settings/-leave-organization-section.tsx': {
      uses: 2,
      decides: 'whether the reader is the only account admin',
    },
  }

  it('use hasRole only for the rank decisions listed, never for what a person may do', () => {
    const uses = Object.fromEntries(
      ROUTES.map(
        (file) => [pathOf(file), countOf(file, /\bhasRole\(/gu)] as const,
      ).filter(([, count]) => count > 0),
    )

    expect(uses).toEqual(
      Object.fromEntries(
        Object.entries(RANK_DECISIONS).map(([path, { uses: count }]) => [path, count]),
      ),
    )
  })

  it('tells a component check from one in the route options', () => {
    const file: SourceFile = {
      path: 'src/routes/example.tsx',
      text: [
        "export const Route = createFileRoute('/example')({",
        '  beforeLoad: ({ context }) => {',
        "    if (!can(context.role, 'staff.read')) throw refused()",
        '  },',
        '  component: Example,',
        '})',
        'function Example() {',
        "  return <Page canManage={can(role, 'staff.manage')} />",
        '}',
      ].join('\n'),
    }

    expect(staticChecksInComponents(file)).toEqual([8])
  })
})
