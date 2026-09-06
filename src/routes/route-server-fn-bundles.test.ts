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
import { describe, expect, it } from 'vitest'

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

/** `  name: someFn,` — a value property, captured when the module evaluates. */
const EAGER_MEMBER = /^ {2}([a-zA-Z][a-zA-Z0-9]*):\s*[a-zA-Z][a-zA-Z0-9]*Fn,?$/gmu

/** `  get name() {` — resolved when the property is read. */
const LAZY_MEMBER = /^ {2}get\s+([a-zA-Z][a-zA-Z0-9]*)\(\)\s*\{$/gmu

describe('route server-fn bundles', () => {
  it('finds the bundles it is meant to guard', () => {
    // A broken walk would make the assertions below vacuously pass.
    const files = bundles.map(({ file }) => file)
    expect(files).toContain(join('src', 'routes', '_authenticated', '-inbox-fns.ts'))
    expect(files).toContain(join('src', 'routes', '-notification-fns.ts'))
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
