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
// The build-time gate `scripts/verify-ai-egress-gateway-bundle.mjs` proves the
// SAME property about the emitted bundle. This suite fails in the editor and on
// every unit run, long before a bundle exists.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

/** The one module allowed to construct the provider client. */
const SOLE_SDK_IMPORTER = join('services', 'ai-egress-gateway', 'openai-connector.ts')

/** Structured-output helpers are part of the SDK surface and stay with it. */
const ZOD_HELPER_ROOT = join('services', 'ai-egress-gateway') + sep

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
 */
const productionSources: ReadonlyArray<Readonly<{ file: string; source: string }>> =
  ROOTS.flatMap((root) => walkProduction(join(ROOT, root))).map((full) => ({
    file: relative(ROOT, full),
    source: readFileSync(full, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .replace(/\/\/.*$/gmu, ''),
  }))

describe('provider client singleton', () => {
  it('walks a non-empty production tree', () => {
    // A broken walk would make every assertion below vacuously pass.
    expect(productionSources.length).toBeGreaterThan(500)
    expect(productionSources.map(({ file }) => file)).toContain(SOLE_SDK_IMPORTER)
  })

  it('imports the OpenAI SDK in exactly one production module', () => {
    expect(
      productionSources
        .filter(({ source }) => /from\s+['"]openai['"]/u.test(source))
        .map(({ file }) => file)
        .sort(),
    ).toEqual([SOLE_SDK_IMPORTER])
  })

  it('keeps the SDK zod helpers inside the gateway', () => {
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

  it('keeps provider credentials out of the application environment schema', () => {
    // env.ts is the contract every deployed service parses at boot. An OPENAI
    // key here would make the whole application a credential holder; only the
    // gateway service's own environment module may name it.
    const env = productionSources.find(
      ({ file }) => file === join('src', 'shared', 'config', 'env.ts'),
    )
    expect(env).toBeDefined()
    expect(env?.source).not.toMatch(/OPENAI/u)
  })
})
