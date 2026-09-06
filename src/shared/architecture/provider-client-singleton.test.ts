// The OpenAI SDK must exist in exactly one place.
//
// WHY A TEST AND NOT A CONVENTION. The provider client carries the API key, the
// transport, the retry policy and the request shape the merchant AI notice
// describes. A second `new OpenAI(...)` anywhere would be a second egress path
// with its own timeouts and its own idea of what gets sent — reachable from web
// or worker code, outside the gateway that redacts, minimizes and records the
// operation profile. That is not a style preference; it is the boundary the AI
// notice depends on, so it is asserted over the real file tree rather than
// trusted to review.
//
// This walks production files only. Tests may import the SDK freely: they run
// against no provider and ship in no image.
//
// WP2.3 changed what backs this. A build gate used to prove the same property
// about the gateway sidecar's emitted bundle, so this suite was the fast copy of
// a check that also ran on the image. The sidecar and its bundle gate are gone,
// which makes this suite the ONLY thing asserting the property — so it matters
// more now, not less.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

/** The one module allowed to construct the provider client. */
const SOLE_SDK_IMPORTER = join(
  'src',
  'shared',
  'ai-provider-control',
  'openai-connector.ts',
)

/** Structured-output helpers are part of the SDK surface and stay with it. */
const ZOD_HELPER_ROOT = join('src', 'shared', 'ai-provider-control') + sep

const ROOTS = ['src', 'services', 'scripts'] as const

/** Recursively list .ts/.mjs files under dir, excluding tests and fixtures. */
function walkProduction(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...walkProduction(full))
      continue
    }
    if (!/\.(ts|mjs)$/u.test(entry)) continue
    if (/\.test\.ts$|\.test-fixtures\.ts$|\.stories\.tsx$/u.test(entry)) continue
    out.push(full)
  }
  return out
}

/**
 * Every production file with its comments removed, read once. Comments are
 * stripped so the prose above — which names `openai` and `OPENAI` — cannot
 * satisfy or trip the assertions that follow.
 *
 * LINE COMMENTS COME OFF FIRST, and the order is load-bearing. Stripping block
 * comments first was silently destroying most of every heavily-commented file:
 * a line comment mentioning a glob like `scripts/ops/[star]` or a path like
 * `/api/auth/[star]` leaves an unbalanced block-comment opener, and the block
 * pass then deletes everything from there to the next real terminator. `env.ts`
 * was arriving here at 6,199 of its 31,358 characters, which is how the
 * assertion below used to pass while asserting nothing. Removing whole-line
 * comments first means those fragments are gone before anything looks for a
 * block. (`[star]` is spelled out above because writing the real sequence in
 * this comment closes it — the bug, demonstrated on itself.)
 */
const productionSources: ReadonlyArray<Readonly<{ file: string; source: string }>> =
  ROOTS.flatMap((root) => walkProduction(join(ROOT, root))).map((full) => ({
    file: relative(ROOT, full),
    source: readFileSync(full, 'utf8')
      .replace(/\/\/.*$/gmu, '')
      .replace(/\/\*[\s\S]*?\*\//gu, ''),
  }))

describe('provider client singleton', () => {
  it('walks a non-empty production tree', () => {
    // A broken walk would make every assertion below vacuously pass.
    expect(productionSources.length).toBeGreaterThan(500)
    expect(productionSources.map(({ file }) => file)).toContain(SOLE_SDK_IMPORTER)
  })

  it('strips comments without destroying the code underneath', () => {
    // The control that was missing. Every assertion here is a search for a
    // token, so a stripper that eats real code turns each one into a silent
    // pass. `env.ts` is the worst case in the tree — the most comment-dense
    // file, with globs and paths inside those comments — so it is the canary.
    const env = productionSources.find(
      ({ file }) => file === join('src', 'shared', 'config', 'env.ts'),
    )
    expect(env).toBeDefined()
    expect(env?.source).toMatch(/BETTER_AUTH_SECRET/u)
    expect(env?.source).toMatch(/DATABASE_URL/u)
    // ...and the prose really is gone, so the stripper is not simply a no-op.
    expect(env?.source).not.toMatch(/load-bearing|Comma-separated/u)
  })

  it('imports the OpenAI SDK in exactly one production module', () => {
    expect(
      productionSources
        .filter(({ source }) => /from\s+['"]openai['"]/u.test(source))
        .map(({ file }) => file)
        .sort(),
    ).toEqual([SOLE_SDK_IMPORTER])
  })

  it('keeps the SDK zod helpers beside the connector', () => {
    expect(
      productionSources
        .filter(
          ({ file, source }) =>
            /from\s+['"]openai\/helpers\/zod['"]/u.test(source) &&
            !file.startsWith(ZOD_HELPER_ROOT),
        )
        .map(({ file }) => file)
        .sort(),
    ).toEqual([])
  })

  it('reads the provider key in exactly one production module', () => {
    // This assertion used to be "OPENAI never appears in env.ts", on the
    // reasoning that naming the key there would make the whole application a
    // credential holder. WP2.3 made that false on purpose: the sidecar that
    // used to own the key is gone and the application reads it, a decision taken
    // against the evidence that this process already holds ENCRYPTION_KEY and
    // GOOGLE_CLIENT_SECRET.
    //
    // Re-pinning the old wording would have meant asserting a boundary that no
    // longer exists. What still protects the key is narrowness: env.ts declares
    // it, and exactly one module reads it to construct a client. A second reader
    // would be a second egress path, which is the thing this file exists to stop.
    expect(
      productionSources
        .filter(({ source }) => /OPENAI_API_KEY/u.test(source))
        .map(({ file }) => file)
        .sort(),
    ).toEqual(
      [
        join('src', 'composition', 'ai-egress-runtime.ts'),
        join('src', 'composition', 'provider-runtime.ts'),
        join('src', 'shared', 'ai-provider-control', 'openai-connector.ts'),
        join('src', 'shared', 'config', 'env.ts'),
      ].sort(),
    )
  })
})
