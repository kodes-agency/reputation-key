import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { walk } from '#/shared/testing/source-tree'

const ROOT = process.cwd()

// The Monthly portal goal's server functions stay out of first paint only while
// nothing imports their module statically: a server-function module that two
// entries share is grouped with the stubs first paint loads (vite.config.ts,
// `app-server-fns`), and a shared module reached statically is in the closure.
// Its one way in is its own `import()` in the Goals route's
// queries module.
describe('the Monthly portal goal server functions', () => {
  /** The module, without its extension, from the repository root. */
  const MODULE = join('src', 'contexts', 'reporting', 'server', 'monthly-portal-goals')

  /**
   * Whether `specifier`, written in `file` (from the repository root), names the
   * module: through the `#/` alias or a relative path from any folder, with or
   * without an extension.
   */
  function namesModule(file: string, specifier: string): boolean {
    const bare = specifier.replace(/\.[cm]?[jt]sx?$/u, '')
    const target = bare.startsWith('#/')
      ? join('src', bare.slice(2))
      : bare.startsWith('.')
        ? join(dirname(file), bare)
        : null
    return target === MODULE || target === join(MODULE, 'index')
  }

  /** How a file reaches the module: statically (a value import or re-export), or by import(). */
  function reaches(file: string, text: string) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const found = { statically: false, dynamically: false }
    const visit = (node: ts.Node): void => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        namesModule(file, node.moduleSpecifier.text)
      ) {
        const typeOnly = ts.isImportDeclaration(node)
          ? node.importClause?.isTypeOnly === true
          : node.isTypeOnly
        if (!typeOnly) found.statically = true
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] !== undefined &&
        ts.isStringLiteral(node.arguments[0]) &&
        namesModule(file, node.arguments[0].text)
      ) {
        found.dynamically = true
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    return found
  }

  const sources = walk(join(ROOT, 'src'))
    .filter((full) => /\.tsx?$/u.test(full) && !/\.test\.tsx?$/u.test(full))
    .map((full) => {
      const file = relative(ROOT, full)
      return { file, ...reaches(file, readFileSync(full, 'utf8')) }
    })

  it.each([
    [
      'src/routes/a/-queries.ts',
      '#/contexts/reporting/server/monthly-portal-goals',
      true,
    ],
    ['src/contexts/reporting/build.ts', './server/monthly-portal-goals', true],
    [
      'src/contexts/reporting/application/a.ts',
      '../server/monthly-portal-goals.ts',
      true,
    ],
    ['src/contexts/reporting/server/a.ts', './monthly-portal-goals.js', true],
    [
      'src/contexts/reporting/server/a.ts',
      '#/contexts/reporting/server/monthly-portal-goals/index',
      true,
    ],
    ['src/routes/a.ts', './monthly-portal-goals', false],
    ['src/contexts/reporting/build.ts', './server/monthly-portal-goals-later', false],
    ['src/contexts/reporting/build.ts', 'monthly-portal-goals', false],
  ] as const)('from %s, %s names the module: %s', (file, specifier, named) => {
    expect(namesModule(file, specifier)).toBe(named)
  })

  it('are reached only by their own import()', () => {
    expect(sources.filter((source) => source.statically).map(({ file }) => file)).toEqual(
      [],
    )
    expect(
      sources.filter((source) => source.dynamically).map(({ file }) => file),
    ).toEqual([
      join(
        'src',
        'routes',
        '_authenticated',
        'properties',
        '$propertyId',
        'goals',
        '-portal-goal-queries.ts',
      ),
    ])
  })
})
