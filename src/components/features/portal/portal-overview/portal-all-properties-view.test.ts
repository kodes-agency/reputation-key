import { describe, expect, it } from 'vitest'
import {
  AVELA,
  FORMA,
  HARBOR,
  allPropertiesMembers,
  allPropertiesProperties,
  allPropertiesResults,
  allPropertiesRows,
} from './portal-all-properties-fixtures'
import {
  buildAllPropertiesOverview,
  describeAllProperties,
} from './portal-all-properties-view'
import { indexOverviewResults } from './portal-overview-results'
import { overviewGroup, overviewRow } from './portal-overview-fixtures'
import { propertyId } from '#/shared/domain/ids'

const figures = indexOverviewResults(allPropertiesResults()).sortFigures

const build = (
  search: Parameters<typeof buildAllPropertiesOverview>[2] = {},
  options: {
    rows?: Parameters<typeof buildAllPropertiesOverview>[0]
    pageSize?: number
    withFigures?: boolean
  } = {},
) =>
  buildAllPropertiesOverview(
    options.rows ?? allPropertiesRows(),
    allPropertiesProperties,
    search,
    allPropertiesMembers,
    options.pageSize ?? 20,
    options.withFigures === false ? undefined : figures,
  )

const propertyNames = (page: ReturnType<typeof build>) =>
  page.properties.map((property) => property.name)

const portalNames = (page: ReturnType<typeof build>) =>
  page.properties.map((property) =>
    property.sections.flatMap((section) => section.items.map((item) => item.row.name)),
  )

describe('buildAllPropertiesOverview', () => {
  it('lists every Portal under its Property, Properties A to Z by default', () => {
    const page = build()

    expect(propertyNames(page)).toEqual([
      'Avela Resort',
      'Forma Kitchen',
      'The Harbor Hotel',
    ])
    expect(portalNames(page)).toEqual([
      [
        'Guest rooms',
        'Olive Terrace restaurant',
        'Pool & Terrace',
        'Pool bar',
        'Reception',
        'Spa & thermal pools',
      ],
      ['Dining room', 'Takeaway'],
      ['Harbour bar', 'Rooms', 'Terrace'],
    ])
    expect(page.total).toBe(11)
    expect(page.matched).toBe(11)
    expect(page.propertyCount).toBe(3)
  })

  it('counts a Property’s Portals, whatever the search keeps', () => {
    const page = build({ q: 'terrace' })

    const avela = page.properties.find((property) => property.propertyId === AVELA)
    expect(avela?.memberCount).toBe(6)
    expect(avela?.matchedCount).toBe(2)
  })

  it('draws a Property with no groups as one flat list under its head', () => {
    const [avela] = build().properties

    expect(avela?.sections.map((section) => section.kind)).toEqual(['flat'])
  })

  it('shows a Property’s groups, and the Portals in none, under its head when it has groups', () => {
    const harbor = build(
      {},
      { rows: allPropertiesRows({ harborGroups: true }) },
    ).properties.find((property) => property.propertyId === HARBOR)

    expect(
      harbor?.sections.map((section) => [section.kind, section.group?.name]),
    ).toEqual([
      ['group', 'Front of house'],
      ['ungrouped', undefined],
    ])
    expect(harbor?.sections[0]?.memberCount).toBe(2)
    expect(harbor?.sections[1]?.memberCount).toBe(1)
  })

  it('keeps one Property’s group out of another’s, even with the same name', () => {
    const rows = [
      overviewRow('x1', {
        propertyId: AVELA,
        group: overviewGroup('g-a', 'Pool'),
      }),
      overviewRow('x2', {
        propertyId: HARBOR,
        group: overviewGroup('g-b', 'Pool'),
      }),
    ]

    const page = build({}, { rows })

    expect(page.properties.map((property) => property.sections.length)).toEqual([1, 1])
    expect(page.properties.map((property) => property.sections[0]?.group?.id)).toEqual([
      'g-a',
      'g-b',
    ])
  })

  it('says Google needs reconnecting where the Property’s link is gone, and says nothing otherwise', () => {
    const page = build()

    expect(page.properties.map((property) => property.googleNotice)).toEqual([
      null,
      null,
      'Google link needs reconnecting',
    ])
  })

  describe('search', () => {
    it('matches a Portal by name, whichever Property it is in', () => {
      const page = build({ q: 'bar' })

      expect(propertyNames(page)).toEqual(['Avela Resort', 'The Harbor Hotel'])
      expect(portalNames(page)).toEqual([['Pool bar'], ['Harbour bar']])
      expect(page.matched).toBe(2)
    })

    it('keeps every Portal of a Property whose name matches', () => {
      const page = build({ q: 'forma' })

      expect(propertyNames(page)).toEqual(['Forma Kitchen'])
      expect(portalNames(page)).toEqual([['Dining room', 'Takeaway']])
    })

    it('matches a group by name', () => {
      const page = build(
        { q: 'front of house' },
        { rows: allPropertiesRows({ harborGroups: true }) },
      )

      expect(portalNames(page)).toEqual([['Rooms', 'Terrace']])
    })

    it('drops a Property none of whose Portals match', () => {
      expect(propertyNames(build({ q: 'dining' }))).toEqual(['Forma Kitchen'])
    })

    it('answers no Properties when nothing matches', () => {
      const page = build({ q: 'zzz' })

      expect(page.properties).toEqual([])
      expect(page.matched).toBe(0)
      expect(page.total).toBe(11)
      expect(page.from).toBe(0)
    })
  })

  describe('sort', () => {
    it('reads Properties and Portals backwards for Z to A', () => {
      const page = build({ sort: 'name', dir: 'desc' })

      expect(propertyNames(page)).toEqual([
        'The Harbor Hotel',
        'Forma Kitchen',
        'Avela Resort',
      ])
      expect(portalNames(page)[2]?.[0]).toBe('Spa & thermal pools')
    })

    it('puts the Property with the most scans first, and its busiest Portal first', () => {
      const page = build({ sort: 'scans' })

      expect(propertyNames(page)).toEqual([
        'Avela Resort',
        'The Harbor Hotel',
        'Forma Kitchen',
      ])
      expect(portalNames(page)[0]?.slice(0, 2)).toEqual(['Reception', 'Pool & Terrace'])
    })

    it('puts the Property with the fewest scans first when asked', () => {
      expect(propertyNames(build({ sort: 'scans', dir: 'asc' }))[0]).toBe('Forma Kitchen')
    })

    it('leaves a Property with no figure after the ones that have one, in either direction', () => {
      const withoutHarbor = {
        ...figures,
        property: (id: string) => (id === HARBOR ? null : figures.property(id)),
      }
      const descending = buildAllPropertiesOverview(
        allPropertiesRows(),
        allPropertiesProperties,
        { sort: 'scans' },
        [],
        20,
        withoutHarbor,
      )
      const ascending = buildAllPropertiesOverview(
        allPropertiesRows(),
        allPropertiesProperties,
        { sort: 'scans', dir: 'asc' },
        [],
        20,
        withoutHarbor,
      )

      expect(descending.properties.at(-1)?.propertyId).toBe(HARBOR)
      expect(ascending.properties.at(-1)?.propertyId).toBe(HARBOR)
    })

    it('falls back to the name order while the results are not here', () => {
      const page = build({ sort: 'scans' }, { withFigures: false })

      expect(propertyNames(page)).toEqual([
        'Avela Resort',
        'Forma Kitchen',
        'The Harbor Hotel',
      ])
    })

    it('puts the Property with the most pressing Portal first for attention', () => {
      const rows = [
        overviewRow('calm', { propertyId: AVELA, name: 'Calm' }),
        overviewRow('draft', {
          propertyId: FORMA,
          name: 'Unfinished',
          publicationState: 'draft',
        }),
      ]

      const page = build({ sort: 'attention' }, { rows })

      expect(propertyNames(page)).toEqual(['Forma Kitchen', 'Avela Resort'])
    })
  })

  describe('paging', () => {
    it('pages across Properties, a page holding only the Properties that have Portals on it', () => {
      const first = build({}, { pageSize: 8 })
      const second = build({ page: 2 }, { pageSize: 8 })

      expect(portalNames(first).flat()).toHaveLength(8)
      expect(propertyNames(first)).toEqual(['Avela Resort', 'Forma Kitchen'])
      expect(portalNames(first)[1]).toEqual(['Dining room', 'Takeaway'])
      expect(propertyNames(second)).toEqual(['The Harbor Hotel'])
      expect(first.lastPage).toBe(2)
      expect([first.from, first.to]).toEqual([1, 8])
      expect([second.from, second.to]).toEqual([9, 11])
    })

    it('says how many Portals a Property holds on a page that shows only some', () => {
      const page = build({ page: 2 }, { pageSize: 4 })
      const [avela] = page.properties

      expect(propertyNames(page)).toEqual(['Avela Resort', 'Forma Kitchen'])
      expect(avela?.memberCount).toBe(6)
      expect(avela?.matchedCount).toBe(6)
      expect(avela?.sections.flatMap((section) => section.items)).toHaveLength(2)
    })

    it('clamps a page past the end to the last', () => {
      expect(build({ page: 99 }, { pageSize: 8 }).page).toBe(2)
    })
  })

  it('answers an Organization with no Portals', () => {
    const page = build({}, { rows: [] })

    expect(page).toMatchObject({ properties: [], total: 0, matched: 0, propertyCount: 0 })
  })

  it('names a Property it was not told about, rather than dropping its Portals', () => {
    const rows = [overviewRow('lost', { propertyId: propertyId('prop-unknown') })]

    const page = build({}, { rows })

    expect(page.properties).toHaveLength(1)
    expect(page.properties[0]?.name).toBe('Another property')
  })
})

describe('describeAllProperties', () => {
  it('says how many Properties and Portals the Organization has, as board 10 does', () => {
    expect(
      describeAllProperties(
        { properties: 3, portals: 11, known: 3 },
        'Avela Hospitality',
      ),
    ).toBe('All 3 properties in Avela Hospitality · 11 portals')
  })

  it('does not say "all" when the reader sees only some of the Properties', () => {
    expect(
      describeAllProperties({ properties: 2, portals: 8, known: 5 }, 'Avela Hospitality'),
    ).toBe('2 properties in Avela Hospitality · 8 portals')
  })

  it('says one in the singular', () => {
    expect(
      describeAllProperties({ properties: 1, portals: 1, known: 1 }, 'Avela Hospitality'),
    ).toBe('1 property in Avela Hospitality · 1 portal')
  })

  it('names no Organization it was not given', () => {
    expect(
      describeAllProperties({ properties: 2, portals: 4, known: 2 }, undefined),
    ).toBe('All 2 properties · 4 portals')
  })

  it('has nothing to say with no Portals', () => {
    expect(
      describeAllProperties({ properties: 0, portals: 0, known: 2 }, 'Avela'),
    ).toBeUndefined()
  })
})
