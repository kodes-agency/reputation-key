import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BROWSER_REACHABLE_AREAS,
  SERVER_ONLY_AREAS,
  SHARED_CATCH_ALL_REPLACEMENT_ELEMENTS,
  SHARED_DEPENDENCY_POLICY,
  sharedAreaElements,
  TEST_ONLY_AREA,
} from './shared-dependency-policy'

const ROOT = resolve(import.meta.dirname, '../../..')
const SHARED_ROOT = resolve(ROOT, 'src/shared')

function currentFirstLevelAreas(): readonly string[] {
  return readdirSync(SHARED_ROOT, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        readdirSync(resolve(SHARED_ROOT, entry.name), { withFileTypes: true }).length > 0,
    )
    .map((entry) => entry.name)
    .sort()
}

function rowFor(area: string) {
  const row = SHARED_DEPENDENCY_POLICY.find((candidate) => candidate.area === area)
  if (!row) throw new Error(`No shared dependency row for ${area}`)
  return row
}

describe('shared dependency policy', () => {
  it('declares exactly one row per first-level shared area', () => {
    expect(SHARED_DEPENDENCY_POLICY.map(({ area }) => area).sort()).toEqual(
      currentFirstLevelAreas(),
    )
    expect(new Set(SHARED_DEPENDENCY_POLICY.map(({ area }) => area)).size).toBe(
      SHARED_DEPENDENCY_POLICY.length,
    )
  })

  it('only permits dependencies on areas that are themselves declared', () => {
    const declared = new Set(SHARED_DEPENDENCY_POLICY.map(({ area }) => area))
    const undeclared = SHARED_DEPENDENCY_POLICY.flatMap(({ area, allows }) =>
      allows
        .filter((target) => !declared.has(target))
        .map((target) => `${area} -> ${target}`),
    )
    expect(undeclared).toEqual([])
  })

  it('keeps every row self-contained and sorted so the rendered policy is stable', () => {
    for (const { area, allows } of SHARED_DEPENDENCY_POLICY) {
      expect(allows, area).toContain(area)
      expect([...allows], area).toEqual([...allows].sort())
      expect(new Set(allows).size, area).toBe(allows.length)
    }
  })

  it('keeps browser-reachable areas away from server-only runtimes', () => {
    // A single edge here is enough to pull a queue client, a database driver
    // or a provider lease into the client bundle.
    for (const area of BROWSER_REACHABLE_AREAS) {
      for (const serverOnly of SERVER_ONLY_AREAS) {
        expect(rowFor(area).allows, `${area} -> ${serverOnly}`).not.toContain(serverOnly)
      }
    }
  })

  it('keeps shared domain pure', () => {
    expect(rowFor('domain').allows).toEqual(['domain'])
  })

  it('never lets a production area depend on the test-only area', () => {
    const leaks = SHARED_DEPENDENCY_POLICY.filter(
      ({ area, allows }) => area !== TEST_ONLY_AREA && allows.includes(TEST_ONLY_AREA),
    ).map(({ area }) => area)
    expect(leaks).toEqual([])
  })

  it('gives every area an eslint element pattern, so none falls into the root bucket', () => {
    const config = readFileSync(resolve(ROOT, 'eslint.config.js'), 'utf8')
    const missing = SHARED_DEPENDENCY_POLICY.filter(
      ({ area }) => !config.includes(`pattern: 'src/shared/${area}/**'`),
    ).map(({ area }) => area)
    expect(missing).toEqual([])
  })

  it('matches the element list the outer layers use in place of shared-other', () => {
    const config = readFileSync(resolve(ROOT, 'eslint.config.js'), 'utf8')
    const declared = config
      .slice(
        config.indexOf('const sharedAreaElements = ['),
        config.indexOf(']', config.indexOf('const sharedAreaElements = [')),
      )
      .split('\n')
      .map((line) => /'([^']+)'/u.exec(line.trim())?.[1])
      .filter((entry): entry is string => Boolean(entry))
    expect(declared).toEqual([...SHARED_CATCH_ALL_REPLACEMENT_ELEMENTS])
    // shared-other is gone: no policy may still name it.
    expect(config).not.toContain("elementType('shared-other')")
    expect(config).not.toContain("'shared-other',")
  })

  it('maps areas that already owned an element onto that element name', () => {
    expect(sharedAreaElements('domain')).toEqual(['shared-domain'])
    expect(sharedAreaElements('testing')).toEqual(['test-helpers'])
    // The relay subtree is reachable from the outbox area alone. Expanding
    // `outbox` to both elements for every caller silently granted db, health,
    // jobs, observability and ops an edge into the relay that the previous
    // config rejected — caught by a differential lint, not by this test.
    expect(sharedAreaElements('outbox')).toEqual(['shared-outbox'])
    expect(sharedAreaElements('outbox', 'outbox')).toEqual([
      'shared-outbox',
      'shared-outbox-infra',
    ])
    expect(sharedAreaElements('queries')).toEqual(['shared-queries'])
  })
})
