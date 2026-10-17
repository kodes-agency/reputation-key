// A route server-fn bundle must resolve its members lazily.
//
// WHY A TEST AND NOT A CONVENTION. These bundles are the seam between routes
// (the only place allowed to import `server/`) and components (which receive
// them as props). Each draws server fns from one or more contexts, and the
// client build is free to place those contexts in chunks that import this one
// back — `-inbox-fns` and `-notification-fns` both landed inside genuine import
// cycles. Under ESM one side of a cycle evaluates while the other is still
// uninitialized, and the bundler emits `var`, so a premature read is
// `undefined` rather than a thrown TDZ error.
//
// An eagerly-built object literal freezes that `undefined` in. The observed
// failure: the inbox activity timeline rendered "Activity 0 events" and
// "Failed to load activity" with NO request issued, because calling `undefined`
// throws inside the React Query `queryFn` before any fetch happens. Typecheck
// was clean, the build succeeded, and the server had nothing to log. Reply
// suggestion shared the defect with no test to catch it.
//
// So the invariant is not decoration — it is the fix. A getter reads the
// binding at property-access time, after every module in the cycle has
// initialized, which makes chunking unable to decide whether these tables hold
// functions or `undefined`. This asserts the shape because the shape IS the
// contract; a value property is the bug, and it fails silently and remotely.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { walk } from '#/shared/testing/source-tree'

const ROOT = process.cwd()
const ROUTES = join(ROOT, 'src', 'routes')

/** Every `-*fns.ts` bundle under src/routes, at any depth. */
function findBundles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...findBundles(full))
      continue
    }
    if (/^-[a-z-]*fns\.ts$/u.test(entry)) out.push(full)
  }
  return out
}

const bundles = findBundles(ROUTES).map((full) => ({
  file: relative(ROOT, full),
  source: readFileSync(full, 'utf8'),
}))

/** `  name: serverFunction,` — a value captured when the module evaluates. */
const EAGER_MEMBER = /^ {2}([a-zA-Z][a-zA-Z0-9]*):\s*[a-zA-Z][a-zA-Z0-9]*,?$/gmu

/** `  get name() {` — resolved when the property is read. */
const LAZY_MEMBER = /^ {2}get\s+([a-zA-Z][a-zA-Z0-9]*)\(\)\s*\{$/gmu

describe('route server-fn bundles', () => {
  it('finds the bundles it is meant to guard', () => {
    // A broken walk would make the assertions below vacuously pass.
    const files = bundles.map(({ file }) => file)
    expect(files).toContain(join('src', 'routes', '_authenticated', '-inbox-fns.ts'))
    expect(files).toContain(join('src', 'routes', '-notification-fns.ts'))
    expect(files).toContain(
      join(
        'src',
        'routes',
        '_authenticated',
        'properties',
        'import-google',
        '-import-fns.ts',
      ),
    )
  })

  it('captures no server fn eagerly', () => {
    const offenders = bundles.flatMap(({ file, source }) =>
      [...source.matchAll(EAGER_MEMBER)].map(({ 1: member }) => `${file}#${member}`),
    )
    expect(offenders).toEqual([])
  })

  it('exposes every member as a getter', () => {
    // Guards the inverse mistake: a bundle that satisfies the rule above by
    // having no members at all, or by dropping one during a refactor.
    for (const { file, source } of bundles) {
      const members = [...source.matchAll(LAZY_MEMBER)].map(({ 1: m }) => m)
      expect(members.length, `${file} exposes no members`).toBeGreaterThan(0)
      expect(new Set(members).size, `${file} declares a member twice`).toBe(
        members.length,
      )
    }
  })
})

// The Monthly portal goal's server functions stay out of first paint only while
// nothing imports their module statically: a server-function module that two
// entries share is grouped with the stubs first paint loads (vite.config.ts,
// `app-server-fns`), and a shared module reached statically is in the closure
// (PLAN §0.2, §3.3). Its one way in is its own `import()` in the Goals route's
// queries module.
describe('the Monthly portal goal server functions', () => {
  const MODULE = /^(?:#\/contexts\/reporting\/server|\.)\/monthly-portal-goals$/u

  /** How a file reaches the module: statically (a value import or re-export), or by import(). */
  function reaches(file: string, text: string) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const found = { statically: false, dynamically: false }
    const visit = (node: ts.Node): void => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        MODULE.test(node.moduleSpecifier.text)
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
        MODULE.test(node.arguments[0].text)
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
