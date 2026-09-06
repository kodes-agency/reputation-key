// The Google authorization vector is built in five places and compared by
// STRICT key-set equality. They have to agree, and nothing makes them.
//
// WHY A TEST AND NOT A CONVENTION. `sameGoogleContentAuthorizationVector`
// compares two vectors by sorted key list AND per-key value, so a vector with
// one extra or one missing key is not "mostly equal" — it is a refusal. The
// resolver in `google-content-authorization-check.ts` produces the vector, and
// each of the four capability authorizers independently RECONSTRUCTS what it
// expects that vector to be. Five hand-written object literals, one exact
// equality rule, and no compiler relationship between them.
//
// This is not hypothetical. Removing two keys from the resolver alone — which
// is what deleting the approval control plane implies — passed typecheck,
// lint:ci, the resolver's own suite, the whole Integration context's
// integration tests and 10,090 unit tests, then failed the `e2e` job thirteen
// minutes later as Google review sync refusing every call with
// `ReviewProviderSnapshotFailure`: two layers away from the edit and with no
// local signal at all.
//
// So this asserts the property that binds the five sites: every key an
// authorizer expects is a key the resolver can emit. It compares KEYS, not
// values — values legitimately differ per request, and comparing them is what
// the production code already does.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

/**
 * The keys of the authorization-vector object literal in `source`.
 *
 * Anchoring is on the literal's own FIRST key rather than on a surrounding
 * declaration, because these builders take `Extract<…, { ok: true }>` in their
 * signatures and a naive "first `{` after the name" lands in that type
 * argument. All five literals begin with `executionPolicyVersion`, so that is
 * the anchor and the opening brace is found by walking back from it.
 *
 * Reading source rather than calling the builders is deliberate: each needs a
 * live database transaction, a connection row, a property binding and a
 * content authorization to run, and the thing under test is the literal a
 * developer edits. A runtime comparison would need five fixtures that could
 * drift from production in exactly the way the literals can.
 */
function vectorLiteralKeys(source: string, marker: string): readonly string[] {
  const from = source.indexOf(marker)
  if (from < 0) throw new Error(`marker not found: ${marker}`)
  const anchor = source.indexOf('executionPolicyVersion', from)
  if (anchor < 0) throw new Error(`no vector literal after: ${marker}`)
  const open = source.lastIndexOf('{', anchor)
  if (open < 0) throw new Error(`no opening brace before: ${marker}`)

  let depth = 0
  let end = open
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) {
        end = index
        break
      }
    }
  }

  // Depth-0 entries only. Both `name:` and the shorthand `name,` count — the
  // import authorizer uses the shorthand for `executionPolicyVersion`, and a
  // parser that missed it would report a key missing that is present. A false
  // alarm is as harmful as a miss: it gets "fixed" by deleting a live key.
  const keys: string[] = []
  let nesting = 0
  for (const line of source.slice(open + 1, end).split('\n')) {
    if (nesting === 0) {
      const match = /^([A-Za-z][A-Za-z0-9]*)\s*[:,]/u.exec(line.trim())
      if (match) keys.push(match[1]!)
    }
    nesting += (line.match(/[{[(]/gu) ?? []).length
    nesting -= (line.match(/[}\])]/gu) ?? []).length
  }
  return keys.sort()
}

const RESOLVER = read(
  'src/contexts/integration/infrastructure/google-content-authorization-check.ts',
)

/** Whether the resolver emits `key`, in either `key:` or shorthand form. */
const emitsKey = (key: string): boolean =>
  new RegExp(`\\b${key}\\s*[:,]`, 'u').test(RESOLVER)

const BUILDERS = [
  [
    'review-sync',
    'src/contexts/integration/application/google-review-sync-authorizer.ts',
    'function expectedSystemVector(',
  ],
  [
    'reply-publication',
    'src/contexts/integration/application/google-reply-publication-authorizer.ts',
    'function expectedSystemVector(',
  ],
  [
    'performance',
    'src/contexts/integration/application/google-performance-authorizer.ts',
    'const expectedAuthorizationVector = Object.freeze(',
  ],
  [
    'import',
    'src/contexts/integration/application/google-import-command-authorizer.ts',
    'const expectedAuthorizationVector = {',
  ],
] as const

describe('authorization vector key parity', () => {
  it('parses a real key set out of every one of the five sites', () => {
    // A parser that silently returned nothing would make the assertions below
    // vacuously pass, which is the failure mode this whole file exists for.
    expect(vectorLiteralKeys(RESOLVER, 'vector: {')).toContain('executionPolicyVersion')
    for (const [name, path, marker] of BUILDERS) {
      const keys = vectorLiteralKeys(read(path), marker)
      expect(keys, name).toContain('executionPolicyVersion')
      expect(keys.length, name).toBeGreaterThan(5)
    }
  })

  it('has no expectation builder claiming a key the resolver cannot emit', () => {
    const orphans = BUILDERS.flatMap(([name, path, marker]) =>
      vectorLiteralKeys(read(path), marker)
        .filter((key) => !emitsKey(key))
        .map((key) => `${name}#${key}`),
    )
    expect(orphans).toEqual([])
  })

  it('excludes from the frozen comparison only keys the vector still has', () => {
    // `FROZEN_VECTOR_EXCLUDED_KEYS` names keys to ignore in a cross-time
    // comparison. An entry for a key that no longer exists is dead weight that
    // reads as a live exemption — which is how the next reader mis-reads it.
    const vector = read('src/shared/domain/google-content-authorization-vector.ts')
    const listed = [
      ...(/FROZEN_VECTOR_EXCLUDED_KEYS = \[([^\]]*)\]/u.exec(vector)?.[1] ?? '').matchAll(
        /'([A-Za-z][A-Za-z0-9]*)'/gu,
      ),
    ].map(([, key]) => key!)

    expect(listed.length).toBeGreaterThan(0)
    for (const key of listed) expect(emitsKey(key), key).toBe(true)
  })
})
