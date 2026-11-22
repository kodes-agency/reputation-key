import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import targets from './mutation-targets.json'
import {
  formatReport,
  mutationSites,
  pickSites,
  plant,
  type MutationTarget,
} from './mutation-sample'

const source = `
import { x } from './x'
type Window = { days: 30 }
export function decide(a: number, role: string): boolean {
  if (a >= 30 && role === 'owner') return true
  if (!a) throw new Error('missing')
  const label = 'id-' + a
  return a > 0 ? false : true
}
`

const kinds = (text: string) => mutationSites(text, 'decide.ts').map((site) => site.kind)

describe('mutationSites', () => {
  it('finds operators, compared strings, ifs, throws, ternaries, numbers and returned booleans', () => {
    expect(new Set(kinds(source))).toEqual(
      new Set([
        'operator',
        'compared-string',
        'negate-if',
        'drop-throw',
        'swap-ternary',
        'number',
        'boolean',
      ]),
    )
  })

  it('leaves imports, types and string concatenation alone', () => {
    const sites = mutationSites(source, 'decide.ts')
    expect(sites.some((site) => site.original.includes("'./x'"))).toBe(false)
    expect(
      sites.filter((site) => site.kind === 'number').map((site) => site.line),
    ).toEqual([5, 8])
    expect(sites.some((site) => site.kind === 'operator' && site.original === '+')).toBe(
      false,
    )
  })

  it('plants each change where it was found', () => {
    const sites = mutationSites(source, 'decide.ts')
    const flip = sites.find((site) => site.kind === 'operator' && site.original === '>=')!
    expect(plant(source, flip)).toContain('if (a > 30 &&')
    const role = sites.find((site) => site.kind === 'compared-string')!
    expect(plant(source, role)).toContain("role === 'owner_planted'")
    const thrown = sites.find((site) => site.kind === 'drop-throw')!
    expect(plant(source, thrown)).toContain('if (!a) void 0')
  })
})

describe('pickSites', () => {
  const sites = mutationSites(source, 'decide.ts')

  it('takes one of each kind before a second of any', () => {
    const picked = pickSites(sites, 7, 'seed')
    expect(new Set(picked.map((site) => site.kind)).size).toBe(7)
  })

  it('picks the same sites for the same seed and others for another', () => {
    expect(pickSites(sites, 3, '2026-11')).toEqual(pickSites(sites, 3, '2026-11'))
    const months = ['2026-11', '2026-12', '2027-01', '2027-02'].map((seed) =>
      JSON.stringify(pickSites(sites, 3, seed)),
    )
    expect(new Set(months).size).toBeGreaterThan(1)
  })

  it('stops when the module has fewer sites than asked for', () => {
    expect(pickSites(sites, 500, 'seed')).toHaveLength(sites.length)
  })
})

describe('formatReport', () => {
  const target: MutationTarget = {
    path: 'src/decide.ts',
    group: 'tenant-policy',
    fault: 'another Organization is allowed',
  }
  const [site] = mutationSites(source, 'decide.ts')

  it('counts caught faults per group and lists every survivor with the fault it lets through', () => {
    const report = formatReport([
      { target, site, outcome: 'caught' },
      { target, site, outcome: 'survived' },
      { target: { ...target, group: 'period-clock' }, outcome: 'no-tests' },
    ])
    expect(report).toContain('tenant-policy: 1 of 2 planted faults caught')
    expect(report).toContain('period-clock: 0 of 0 planted faults caught')
    expect(report).toContain(`survived src/decide.ts:${site!.line}`)
    expect(report).toContain('must catch: another Organization is allowed')
    expect(report).toContain('no-tests src/decide.ts')
  })
})

describe('mutation-targets.json', () => {
  it('names existing modules, each in one of the three groups of rule 31, with its fault', () => {
    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) {
      expect(existsSync(target.path), target.path).toBe(true)
      expect(['tenant-policy', 'attempt-fence', 'period-clock']).toContain(target.group)
      expect(target.fault.length, target.path).toBeGreaterThan(20)
    }
    expect(new Set(targets.map((target) => target.path)).size).toBe(targets.length)
  })
})
