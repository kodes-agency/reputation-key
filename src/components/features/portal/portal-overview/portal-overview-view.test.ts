import { describe, expect, it } from 'vitest'
import { NO_CODE, overviewGroup, overviewRow } from './portal-overview-fixtures'
import {
  channelLabel,
  describeGroupCount,
  describeManagers,
  describeRange,
  buildPortalOverview,
  localeChips,
} from './portal-overview-view'

const pool = overviewGroup('g-pool', 'Pool side')
const front = overviewGroup('g-front', 'Front of house')

const rows = [
  overviewRow('p-terrace', {
    name: 'Pool & Terrace',
    group: pool,
    pendingChangeCount: 2,
  }),
  overviewRow('p-spa', {
    name: 'Spa & thermal pools',
    group: pool,
    responsibleManagerUserIds: [],
  }),
  overviewRow('p-bar', {
    name: 'Pool bar',
    group: pool,
    publicationState: 'draft',
    token: NO_CODE,
  }),
  overviewRow('p-reception', { name: 'Reception', group: front }),
  overviewRow('p-olive', { name: 'Olive Terrace restaurant' }),
]

const build = (
  search: Parameters<typeof buildPortalOverview>[1] = {},
  options: {
    pageSize?: number
    members?: Parameters<typeof buildPortalOverview>[2]
  } = {},
) => buildPortalOverview(rows, search, options.members ?? [], options.pageSize ?? 20)

const names = (page: ReturnType<typeof build>) =>
  page.sections.map((section) => section.items.map((item) => item.row.name))

describe('buildPortalOverview', () => {
  it('groups by group, groups A to Z, ungrouped Portals last', () => {
    const page = build()
    expect(page.sections.map((section) => section.group?.name ?? null)).toEqual([
      'Front of house',
      'Pool side',
      null,
    ])
    expect(page.sections.map((section) => section.kind)).toEqual([
      'group',
      'group',
      'ungrouped',
    ])
  })

  it('sorts Portals by name inside a group', () => {
    expect(names(build())[1]).toEqual([
      'Pool & Terrace',
      'Pool bar',
      'Spa & thermal pools',
    ])
    // Descending reads the groups backwards too: Pool side comes before Front of house.
    expect(names(build({ sort: 'name', dir: 'desc' }))[0]).toEqual([
      'Spa & thermal pools',
      'Pool bar',
      'Pool & Terrace',
    ])
  })

  it('puts what needs attention first, and the group that holds it first', () => {
    const page = build({ sort: 'attention' })
    expect(page.sections.map((section) => section.group?.name ?? null)).toEqual([
      'Pool side',
      'Front of house',
      null,
    ])
    expect(names(page)[0]).toEqual(['Spa & thermal pools', 'Pool & Terrace', 'Pool bar'])
  })

  it('lists archived Portals after the others, in either direction', () => {
    const withArchived = [
      overviewRow('a', {
        name: 'Archived lobby',
        publicationState: 'archived',
        group: pool,
      }),
      ...rows,
    ]
    for (const dir of ['asc', 'desc'] as const) {
      const page = buildPortalOverview(withArchived, { dir }, [], 20)
      const poolSection = page.sections.find((section) => section.group?.id === pool.id)
      expect(poolSection?.items.at(-1)?.row.name).toBe('Archived lobby')
    }
  })

  it('flattens to one unheaded list when not grouping', () => {
    const page = build({ groupBy: 'none' })
    expect(page.sections).toHaveLength(1)
    expect(page.sections[0]?.kind).toBe('flat')
    expect(page.sections[0]?.items.map((item) => item.row.name)).toEqual([
      'Olive Terrace restaurant',
      'Pool & Terrace',
      'Pool bar',
      'Reception',
      'Spa & thermal pools',
    ])
  })

  it('searches Portal and group names, ignoring case', () => {
    expect(names(build({ q: 'TERRACE' })).flat()).toEqual([
      'Pool & Terrace',
      'Olive Terrace restaurant',
    ])
    expect(names(build({ q: 'front of' })).flat()).toEqual(['Reception'])
    expect(build({ q: 'nothing like this' }).sections).toEqual([])
  })

  it('keeps only Portals that need attention when asked', () => {
    expect(
      names(build({ show: 'attention' }))
        .flat()
        .sort(),
    ).toEqual(['Pool & Terrace', 'Pool bar', 'Spa & thermal pools'])
  })

  it('counts a group by its members, not by what the search left', () => {
    const page = build({ q: 'spa' })
    const section = page.sections[0]
    expect(section?.memberCount).toBe(3)
    expect(section?.matchedCount).toBe(1)
    expect(page.total).toBe(5)
    expect(page.matched).toBe(1)
  })

  it('pages across groups and repeats a group head on the page it continues', () => {
    const first = build({}, { pageSize: 3 })
    expect(first.lastPage).toBe(2)
    expect(first.page).toBe(1)
    expect(names(first)).toEqual([['Reception'], ['Pool & Terrace', 'Pool bar']])
    const second = build({ page: 2 }, { pageSize: 3 })
    expect(names(second)).toEqual([['Spa & thermal pools'], ['Olive Terrace restaurant']])
    expect(second.sections[0]?.group?.name).toBe('Pool side')
    expect([second.from, second.to]).toEqual([4, 5])
  })

  it('keeps a page number the list no longer reaches on the last page', () => {
    const page = build({ page: 9 }, { pageSize: 3 })
    expect(page.page).toBe(2)
    expect(page.lastPage).toBe(2)
  })

  it('answers an empty list with no page to show', () => {
    const page = buildPortalOverview([], {}, [], 20)
    expect(page).toMatchObject({
      total: 0,
      matched: 0,
      page: 1,
      lastPage: 1,
      from: 0,
      to: 0,
    })
    expect(page.sections).toEqual([])
  })

  it('leaves the rows it was given alone', () => {
    const before = rows.map((row) => row.name)
    build({ sort: 'attention', dir: 'asc' })
    expect(rows.map((row) => row.name)).toEqual(before)
  })

  it('carries the words each row shows', () => {
    const [front] = build().sections
    const item = front?.items[0]
    expect(item?.channel).toBe('QR and NFC')
    expect(item?.attention).toEqual({ kind: 'none' })
  })
})

describe('channelLabel', () => {
  it('names the code a Portal has, never a place', () => {
    expect(channelLabel(overviewRow('a').token)).toBe('QR and NFC')
    expect(channelLabel(NO_CODE)).toBe('No code yet')
    expect(channelLabel({ ...overviewRow('a').token, qualifiedScanReady: false })).toBe(
      'QR and NFC',
    )
  })
})

describe('localeChips', () => {
  it('lists the primary language first, then the others in the order given', () => {
    const chips = localeChips('en', ['bg', 'es', 'de'])
    expect(chips.chips.map((chip) => chip.label)).toEqual(['EN', 'БГ', 'ES', 'DE'])
    expect(chips.description).toBe('Languages: English, Bulgarian, Spanish, German')
  })

  it('says “Language” for one', () => {
    expect(localeChips('bg', []).description).toBe('Language: Bulgarian')
  })

  it('never lists the primary language twice', () => {
    expect(localeChips('en', ['en', 'fr']).chips.map((chip) => chip.label)).toEqual([
      'EN',
      'FR',
    ])
  })
})

describe('describeManagers', () => {
  const members = [
    { userId: 'u-1', name: 'Georgi Ivanov' },
    { userId: 'u-2', name: 'Elena Petrova' },
  ]

  it('names managers it can, in the order the row lists them', () => {
    const view = describeManagers(['u-1', 'u-2'], members)
    expect(view.managers.map((manager) => manager.initials)).toEqual(['GI', 'EP'])
    expect(view.description).toBe('Georgi Ivanov and Elena Petrova')
    expect(view.isEmpty).toBe(false)
  })

  it('never shows a user id for someone it cannot name', () => {
    const view = describeManagers(['u-1', 'u-9'], members)
    expect(view.managers[1]).toEqual({ userId: 'u-9', name: null, initials: null })
    expect(view.description).toBe('Georgi Ivanov and 1 more')
    expect(JSON.stringify(view.description)).not.toContain('u-9')
  })

  it('counts without names when nobody can be named', () => {
    expect(describeManagers(['u-8', 'u-9'], []).description).toBe('2 managers')
    expect(describeManagers(['u-8'], []).description).toBe('1 manager')
  })

  it('says so when no one is responsible', () => {
    const view = describeManagers([], members)
    expect(view.isEmpty).toBe(true)
    expect(view.description).toBe('No one')
  })

  it('lists three names and the count of the rest', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((id) => ({
      userId: id,
      name: `Person ${id.toUpperCase()}`,
    }))
    const view = describeManagers(['a', 'b', 'c', 'd', 'e'], many)
    expect(view.managers).toHaveLength(5)
    expect(view.description).toBe('Person A, Person B, Person C and 2 more')
  })
})

describe('describeGroupCount', () => {
  it('says how many Portals a group has, and how many the search leaves', () => {
    expect(describeGroupCount(3, 3)).toBe('3 portals')
    expect(describeGroupCount(1, 1)).toBe('1 portal')
    expect(describeGroupCount(3, 1)).toBe('1 of 3 portals')
  })
})

describe('describeRange', () => {
  it('words the page the reader is on', () => {
    expect(describeRange({ from: 1, to: 20, matched: 45 })).toBe('Showing 1–20 of 45')
    expect(describeRange({ from: 0, to: 0, matched: 0 })).toBe('')
  })
})
