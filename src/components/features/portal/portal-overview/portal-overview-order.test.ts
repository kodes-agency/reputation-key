import { describe, expect, it } from 'vitest'
import { NO_CODE, overviewGroup, overviewRow } from './portal-overview-fixtures'
import { buildPortalOverview } from './portal-overview-view'

const pool = overviewGroup('g-pool', 'Pool side')
const front = overviewGroup('g-front', 'Front of house')

const rows = [
  overviewRow('p-terrace', { name: 'Pool & Terrace', group: pool }),
  overviewRow('p-spa', { name: 'Spa & thermal pools', group: pool }),
  overviewRow('p-bar', {
    name: 'Pool bar',
    group: pool,
    publicationState: 'draft',
    token: NO_CODE,
  }),
  overviewRow('p-reception', { name: 'Reception', group: front }),
  overviewRow('p-olive', { name: 'Olive Terrace restaurant' }),
]

// What the read counted, by Portal and by group: Pool & Terrace leads its group and
// Pool side leads the others. The draft has nothing to count.
const SCANS: Readonly<Record<string, number | null>> = {
  'p-terrace': 412,
  'p-spa': 286,
  'p-bar': null,
  'p-reception': 520,
  'p-olive': 351,
  'g-pool': 698,
  'g-front': 520,
}
const figures = {
  portal: (id: string) => SCANS[id] ?? null,
  group: (id: string) => SCANS[id] ?? null,
}

const build = (search: Parameters<typeof buildPortalOverview>[1], withFigures = true) =>
  buildPortalOverview(rows, search, [], 20, withFigures ? figures : undefined)

const names = (page: ReturnType<typeof build>) =>
  page.sections.map((section) => section.items.map((item) => item.row.name))

describe('the overview sorted by qualified scans', () => {
  it('puts the Portal with the most scans first inside a group, and the group with the most first', () => {
    const page = build({ sort: 'scans' })

    expect(page.sections.map((section) => section.group?.name ?? null)).toEqual([
      'Pool side',
      'Front of house',
      null,
    ])
    expect(names(page)[0]).toEqual(['Pool & Terrace', 'Spa & thermal pools', 'Pool bar'])
  })

  it('reads the other way with the direction, keeping what has no figure last', () => {
    const page = build({ sort: 'scans', dir: 'asc' })

    expect(page.sections.map((section) => section.group?.name ?? null)).toEqual([
      'Front of house',
      'Pool side',
      null,
    ])
    expect(names(page)[1]).toEqual(['Spa & thermal pools', 'Pool & Terrace', 'Pool bar'])
  })

  it('lists a Portal with no figure after those with one, by name', () => {
    const page = build({ sort: 'scans', groupBy: 'none' })

    expect(page.sections[0]?.items.map((item) => item.row.name)).toEqual([
      'Reception',
      'Pool & Terrace',
      'Olive Terrace restaurant',
      'Spa & thermal pools',
      'Pool bar',
    ])
  })

  it('falls back to name order while the results are not there', () => {
    expect(names(build({ sort: 'scans' }, false))).toEqual(names(build({}, false)))
  })
})
