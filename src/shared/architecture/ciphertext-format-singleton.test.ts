// Each ciphertext format has exactly one implementation.
//
// WHY A TEST AND NOT A CONVENTION. A ciphertext format is a contract between
// whatever wrote a row and whatever reads it back. When two modules implement
// the same format, they agree only until one of them changes — and the one that
// changes is the one under review, while the copy sits in a helper nobody is
// reading. There is no compiler error and no failing unit test: the rows simply
// stop being decryptable, and the symptom surfaces as a product error from a
// server function, far from the edit that caused it.
//
// This is not hypothetical. `e2e/helpers/fixtures.ts` reimplemented the token
// format under a comment reading "must match token-encryption.adapter.ts". When
// the adapter gained its version prefix it stopped matching, and the only thing
// that noticed was the critical e2e gate failing with `Invalid ciphertext
// format` inside `disconnectGoogle` — a fixture bug wearing a product bug's
// clothes. The fixture now calls the adapter, and this suite is what keeps the
// next copy from being written.
//
// UNLIKE its sibling `provider-client-singleton.test.ts`, this walks TEST and
// FIXTURE files too, because that is precisely where the duplicate lived. A
// helper that forges its own ciphertext is the bug this defends against, so
// exempting helpers would exempt the only observed instance.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

/** Every first-party directory that can hold executable TypeScript. */
const ROOTS = ['src', 'services', 'scripts', 'e2e'] as const

/**
 * The modules that own a format, each with a distinct plaintext and audience:
 * guest contact details, and Google OAuth tokens. A third entry means either a
 * genuine third format — which needs its own justification here — or a copy.
 */
const FORMAT_OWNERS = [
  join(
    'src',
    'contexts',
    'guest',
    'infrastructure',
    'adapters',
    'contact-request-encryption.adapter.ts',
  ),
  join(
    'src',
    'contexts',
    'integration',
    'infrastructure',
    'adapters',
    'token-encryption.adapter.ts',
  ),
] as const

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...walk(full))
      continue
    }
    if (/\.(ts|tsx|mjs)$/u.test(entry)) out.push(full)
  }
  return out
}

/**
 * The symbols searched for, assembled from fragments so this file's own source
 * cannot contain them.
 *
 * Stripping comments is not enough: the needles would still appear as regex
 * literals in the code below, and this file would report itself. Its sibling
 * `provider-client-singleton.test.ts` escapes that only by accident — the
 * metacharacters in its pattern happen to break the self-match. Splitting the
 * strings makes the property deliberate rather than lucky, which matters
 * because a self-report looks exactly like a real second implementation, and
 * the obvious "fix" — exempting this file — would exempt real ones too.
 */
const CIPHER_CONSTRUCTION = new RegExp(
  ['create', 'Cipheriv|create', 'Decipheriv'].join(''),
  'u',
)
const AUTH_TAG_HANDLING = new RegExp(
  ['(get', 'AuthTag|set', 'AuthTag)\\s*\\('].join(''),
  'u',
)

/**
 * Every first-party source with comments removed, so the prose above cannot
 * satisfy or trip the assertions.
 */
const sources: ReadonlyArray<Readonly<{ file: string; source: string }>> = ROOTS.flatMap(
  (root) => walk(join(ROOT, root)),
).map((full) => ({
  file: relative(ROOT, full),
  source: readFileSync(full, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\/\/.*$/gmu, ''),
}))

describe('ciphertext format singleton', () => {
  it('walks a tree that contains the format owners and the e2e helpers', () => {
    // A broken walk would make every assertion below vacuously pass.
    expect(sources.length).toBeGreaterThan(500)
    const files = sources.map(({ file }) => file)
    for (const owner of FORMAT_OWNERS) expect(files).toContain(owner)
    expect(files).toContain(join('e2e', 'helpers', 'fixtures.ts'))
  })

  it('constructs an AES cipher in exactly the modules that own a format', () => {
    expect(
      sources
        .filter(({ source }) => CIPHER_CONSTRUCTION.test(source))
        .map(({ file }) => file)
        .sort(),
    ).toEqual([...FORMAT_OWNERS].sort())
  })

  it('assembles a colon-delimited ciphertext only in those modules', () => {
    // The format is `version:iv:tag:ciphertext`. A second module joining those
    // parts is reimplementing the layout even if it delegates the cipher — and
    // splitting is how a reader hand-parses it. Both directions are the bug.
    const owners = new Set<string>(FORMAT_OWNERS)
    expect(
      sources
        .filter(({ file, source }) => !owners.has(file) && AUTH_TAG_HANDLING.test(source))
        .map(({ file }) => file)
        .sort(),
    ).toEqual([])
  })
})
