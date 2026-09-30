// Slice 1 guard: the guest locale set and the language-pack ids have one home,
// `src/shared/domain/guest-locale.ts`. Production code reads them from there,
// so widening the catalogue never leaves a stale two-locale check behind.
//
// Historical pins stay literal by design (snapshots must verify forever), so
// each file that legitimately spells a locale or pack id is listed below with
// its reason. Tests and stories are not scanned.

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..', '..')

const ALLOWLIST: ReadonlyArray<
  Readonly<{ match: (path: string) => boolean; why: string }>
> = [
  {
    match: (p) => p === 'src/shared/domain/guest-locale.ts',
    why: 'the catalogue itself',
  },
  {
    match: (p) => p === 'src/contexts/portal/domain/portal-publication-snapshot.ts',
    why: 'pinned historical v1/v2 literals; snapshots verify forever',
  },
  {
    match: (p) =>
      p.startsWith('src/components/features/guest/public-portal/language-packs/') ||
      p === 'src/components/features/guest/public-portal/guest-language-pack.ts',
    why: 'the v1 pack constants and their Bulgarian copy',
  },
  {
    match: (p) =>
      p ===
      'src/contexts/portal/infrastructure/repositories/portal-publication.repository.ts',
    why: 'the frozen v1/v2 zod branches that parse stored snapshot rows',
  },
  {
    match: (p) => p === 'src/shared/db/schema/portal.schema.ts',
    why: 'CHECK constraints, until migration 0043 widens them',
  },
  {
    match: (p) => p === 'src/shared/db/schema/portal-publication.schema.ts',
    why: 'snapshot CHECK constraints and the jsonb default, until migration 0043',
  },
  {
    match: (p) => p === 'src/shared/testing/scenarios/executors.ts',
    why: "not a guest locale: 'bg' names the background traffic stream",
  },
]

const FORBIDDEN: ReadonlyArray<Readonly<{ label: string; pattern: RegExp }>> = [
  { label: "'en' | 'bg' union", pattern: /'(?:en|bg)'\s*\|\s*'(?:bg|en)'/ },
  {
    label: "['en', 'bg'] list",
    pattern: /\[\s*'(?:en|bg)'\s*,\s*'(?:bg|en)'\s*\]/,
  },
  { label: "== 'bg' comparison", pattern: /[=!]==?\s*'bg'/ },
  { label: "'bg' == comparison", pattern: /'bg'\s*[=!]==?/ },
  { label: "'bg' ternary", pattern: /'bg'\s*\?/ },
  { label: ".includes('bg') lookup", pattern: /\.includes\(\s*'bg'\s*\)/ },
  { label: 'pinned pack id', pattern: /guest-ui-(?:en|bg)-v1/ },
]

const SCANNED = /\.(?:ts|tsx|mjs)$/
const EXCLUDED = /\.(?:test|stories)\.tsx?$|\.test-fixtures\.tsx?$|\.gen\.ts$/

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (name === 'node_modules' || name === '__fixtures__' || name === '.claude')
      return []
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

function productionFiles(): string[] {
  return ['src', 'scripts']
    .flatMap((top) => walk(join(ROOT, top)))
    .map((full) => relative(ROOT, full).split(sep).join('/'))
    .filter((path) => SCANNED.test(path) && !EXCLUDED.test(path))
}

describe('guest locale literals', () => {
  it.each([
    ["type L = 'bg' | 'en'", "'en' | 'bg' union"],
    ["const l = ['bg', 'en']", "['en', 'bg'] list"],
    ["x == 'bg'", "== 'bg' comparison"],
    ["'bg' != x", "'bg' == comparison"],
    ["x = 'bg' ? 1 : 2", "'bg' ternary"],
    ["list.includes('bg')", ".includes('bg') lookup"],
  ])('recognises the spelling %s', (source, label) => {
    const hits = FORBIDDEN.filter((rule) => rule.pattern.test(source)).map(
      (rule) => rule.label,
    )
    expect(hits).toContain(label)
  })

  it('keeps the two-locale checks and pinned pack ids out of production code', () => {
    const offenders = productionFiles().flatMap((path) => {
      if (ALLOWLIST.some((entry) => entry.match(path))) return []
      const source = readFileSync(join(ROOT, path), 'utf8')
      return FORBIDDEN.filter((rule) => rule.pattern.test(source)).map(
        (rule) => `${path}: ${rule.label}`,
      )
    })
    expect(offenders).toEqual([])
  })

  it('has no stale allowlist entry that no longer needs its exception', () => {
    const files = productionFiles()
    const stale = ALLOWLIST.filter(
      (entry) => !files.some((path) => entry.match(path)),
    ).map((entry) => entry.why)
    expect(stale).toEqual([])
  })
})
