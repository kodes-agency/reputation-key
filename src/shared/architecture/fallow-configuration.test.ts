import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type ScopedUsedClassMemberRule = Readonly<{
  extends?: string
  implements?: string
  members: readonly string[]
}>

type UsedClassMemberRule = string | ScopedUsedClassMemberRule

type FallowConfig = Readonly<{
  entry: readonly string[]
  ignorePatterns: readonly string[]
  usedClassMembers: readonly UsedClassMemberRule[]
  boundaries: Readonly<{
    zones: ReadonlyArray<Readonly<{ name: string; patterns: readonly string[] }>>
    rules: ReadonlyArray<Readonly<{ from: string; allow?: readonly string[] }>>
  }>
}>

const ROOT = process.cwd()
const config = JSON.parse(
  readFileSync(join(ROOT, '.fallowrc.json'), 'utf8'),
) as FallowConfig
const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')

const zoneIndex = (name: string): number =>
  config.boundaries.zones.findIndex((zone) => zone.name === name)

const scopedUsedClassMembers = config.usedClassMembers.filter(
  (rule): rule is ScopedUsedClassMemberRule => typeof rule === 'object',
)

describe('Fallow configuration', () => {
  it('does not claim boundary coverage for ignored source trees', () => {
    for (const zone of config.boundaries.zones) {
      for (const pattern of zone.patterns) {
        expect(
          config.ignorePatterns,
          `${zone.name} ignores its own ${pattern}`,
        ).not.toContain(pattern)
      }
    }
  })

  it('every boundary zone appears in at least one rules[].from or rules[].allow entry', () => {
    const referenced = new Set(
      config.boundaries.rules.flatMap((rule) => [rule.from, ...(rule.allow ?? [])]),
    )

    for (const zone of config.boundaries.zones) {
      expect(
        referenced.has(zone.name),
        `zone ${zone.name} has no import rule, so its edges are unchecked`,
      ).toBe(true)
    }
  })

  it('architecture-fixtures and test-support are declared before the shared zone in boundaries.zones', () => {
    // Zone matching is first-match-wins, so the broad src/shared/** pattern
    // would swallow both test trees and report their deliberate cross-context
    // fixtures as production boundary violations.
    const shared = zoneIndex('shared')

    expect(shared).toBeGreaterThan(-1)
    expect(zoneIndex('architecture-fixtures')).toBeGreaterThan(-1)
    expect(zoneIndex('test-support')).toBeGreaterThan(-1)
    expect(zoneIndex('architecture-fixtures')).toBeLessThan(shared)
    expect(zoneIndex('test-support')).toBeLessThan(shared)
  })

  it('src/shared/testing/** is not in ignorePatterns', () => {
    // Ignoring the tree hid the integration-helpers -> db/testing import edge,
    // which made a live cleanup helper read as an unused file.
    expect(config.ignorePatterns).not.toContain('src/shared/testing/**')
  })

  it('.railway/railway.ts is listed in entry', () => {
    // The Railway IaC definition is loaded by the CLI, never imported, so
    // without an explicit entry its whole subtree reads as unreachable.
    expect(config.entry).toContain('.railway/railway.ts')
  })

  // The next two rules describe structural dispatch and cross-boundary error
  // contracts. Fallow cannot resolve a call made through a structural port or
  // a discriminator read on a serialized error, so without them these members
  // are misreported as dead code and a later deletion slice would remove live
  // behaviour.
  it('usedClassMembers contains a scoped rule for implements OrganizationExportStorage covering putEncrypted/readEncrypted/delete/verifyStored', () => {
    const rule = scopedUsedClassMembers.find(
      (candidate) => candidate.implements === 'OrganizationExportStorage',
    )

    expect(rule).toBeDefined()
    expect(rule?.members).toEqual(
      expect.arrayContaining(['putEncrypted', 'readEncrypted', 'delete', 'verifyStored']),
    )
  })

  it('a scoped rule for extends Error covering _tag and code', () => {
    const rule = scopedUsedClassMembers.find((candidate) => candidate.extends === 'Error')

    expect(rule).toBeDefined()
    expect(rule?.members).toEqual(expect.arrayContaining(['_tag', 'code']))
  })

  it('keeps exact container command assertions parseable as shell commands', () => {
    expect(ci).not.toMatch(/=\s*'\["node","[^"\n]+\.js"\]'/u)
  })

  it('declares the tests zone FIRST, so test files are not measured as production coupling', () => {
    // Zone matching is order-sensitive. A test file importing a domain event
    // constructor to exercise it is not a production boundary violation, and
    // measuring it as one made thirteen honest test files look like coupling.
    const zones = config.boundaries.zones as ReadonlyArray<{ name: string }>
    expect(zones[0]?.name).toBe('tests')

    const rule = (
      config.boundaries.rules as ReadonlyArray<{ from: string; allow: string[] }>
    ).find((candidate) => candidate.from === 'tests')
    expect(rule?.allow).toEqual(expect.arrayContaining(zones.map((zone) => zone.name)))
  })

  it('never lets a production zone reach the tests zone', () => {
    const rules = config.boundaries.rules as ReadonlyArray<{
      from: string
      allow: string[]
    }>
    for (const rule of rules) {
      if (rule.from === 'tests') continue
      expect(rule.allow, rule.from).not.toContain('tests')
    }
  })
})
