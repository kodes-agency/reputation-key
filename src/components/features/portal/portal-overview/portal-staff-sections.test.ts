import { describe, it, expect } from 'vitest'
import { buildPortalOverview } from './portal-overview-view'
import { buildAllPropertiesOverview } from './portal-all-properties-view'
import { overviewRow, overviewGroup, NO_CODE } from './portal-overview-fixtures'
import { sectionExpanded, staffSectionCount } from './portal-staff-sections'
import { staffSectionMeasures } from './portal-staff-measures'
import { measuresOf } from './portal-overview-results-fixtures'
const group = overviewGroup('g', 'Reception')
const rows = [
  overviewRow('z', { kind: 'personal', name: 'Zoe', group, token: NO_CODE }),
  overviewRow('a', { kind: 'personal', name: 'Ana', group, token: NO_CODE }),
  overviewRow('p', { name: 'Place', group, token: NO_CODE }),
  overviewRow('o', { kind: 'personal', name: 'Other person', token: NO_CODE }),
  overviewRow('u', { name: 'Ungrouped', token: NO_CODE }),
]
const figures = {
  portal: (id: string) => (id === 'z' ? 900 : 1),
  group: () => 1,
  property: () => 1,
}
describe('people sections never rank people', () => {
  for (const sort of ['name', 'scans', 'attention'] as const)
    for (const dir of ['asc', 'desc'] as const)
      for (const show of [undefined, 'attention'] as const) {
        it(`${sort} ${dir} ${show ?? 'all'} keeps places first then people A to Z on every page`, () => {
          const search = { sort, dir, show }
          const built = buildPortalOverview(rows, search, [], 99, figures)
          expect(
            built.sections
              .find((s) => s.group?.id === group.id)
              ?.items.map((i) => i.row.name),
          ).toEqual(['Place', 'Ana', 'Zoe'])
          expect(built.sections.at(-1)?.key).toBe('other-staff')
          const all = buildAllPropertiesOverview(rows, [], search, [], 99, figures)
          expect(
            all.properties[0]?.sections.flatMap((s) =>
              s.items.filter((i) => i.row.group).map((i) => i.row.name),
            ),
          ).toEqual(['Place', 'Ana', 'Zoe'])
          const flat = buildPortalOverview(
            rows,
            { ...search, groupBy: 'none' },
            [],
            99,
            figures,
          )
          expect(flat.sections.at(-1)?.items.map((i) => i.row.name)).toEqual([
            'Ana',
            'Other person',
            'Zoe',
          ])
          expect(flat.sections.at(-1)?.key).toBe('staff')
        })
      }
  it('folds groups with people initially, lets the reader unfold, and opens search matches', () => {
    const section = buildPortalOverview(rows, {}, [], 99).sections.find((s) => s.group)!
    expect(sectionExpanded(section, undefined)).toBe(false)
    expect(sectionExpanded(section, false)).toBe(true)
    expect(staffSectionCount(section.staff!)).toBe('1 portal · 2 people')
    const found = buildPortalOverview(rows, { q: 'Zoe' }, [], 99).sections[0]!
    expect(sectionExpanded(found, true)).toBe(true)
    expect(found.items[0]?.row.name).toBe('Zoe')
    const property = buildAllPropertiesOverview(rows, [], { q: 'Zoe' }, [], 99, figures, [
      'prop-1',
    ])
    expect(property.properties[0]?.sections[0]?.items[0]?.row.name).toBe('Zoe')
  })
  it('does not mix the Other staff subtotal with place portals', () => {
    const section = buildPortalOverview(rows, {}, [], 99).sections.at(-1)!
    expect(section.portalIds).toEqual(['o'])
    expect(section.staff?.names).toEqual(['Other person'])
  })
  it('adds only known figures, and never fabricates an unknown average', () => {
    const row = measuresOf({
      scans: 10,
      ratings: 5,
      average: 4.6,
      googleOpens: 2,
      notes: 1,
    })
    expect(staffSectionMeasures([row, row])?.scans.text).toBe('20')
    expect(staffSectionMeasures([row, row])?.average.text).toBe('4.6')
    expect(staffSectionMeasures([])).toBeNull()
  })
})
