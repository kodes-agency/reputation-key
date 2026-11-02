import { expect, it } from 'vitest'
import { overviewGroup, overviewRow } from './portal-overview-fixtures'
import { visiblePortals } from './visible-portals'
import { buildPortalOverview } from './portal-overview-view'
import { buildAllPropertiesOverview } from './portal-all-properties-view'
import { portalListModel } from './portal-list-model'
import { groupHeadCount } from './portal-overview-results'
const group = overviewGroup('desk', 'Desk')
const removed = overviewRow('removed', {
  kind: 'personal',
  publicationState: 'archived',
  group,
})
const place = overviewRow('room', { group, publicationState: 'archived' })
it('drops removed people before every overview count but keeps archived places', () => {
  const rows = [removed, place]
  expect(visiblePortals(rows)).toEqual([place])
  const model = portalListModel({ rows, groups: [group], search: {} })
  expect(model.overview).toMatchObject({ total: 1, matched: 1 })
  expect(groupHeadCount(model.overview.sections[0]!, 2)).toEqual({
    members: 1,
    matched: 1,
  })
  const all = buildAllPropertiesOverview(rows, [], {}, [])
  expect(all).toMatchObject({ total: 1, matched: 1, propertyCount: 1 })
  expect(all.properties[0]).toMatchObject({ memberCount: 1, matchedCount: 1 })
  expect(buildAllPropertiesOverview([removed], [], {}, [])).toMatchObject({
    total: 0,
    matched: 0,
    propertyCount: 0,
  })
  expect(
    portalListModel({ rows: [removed], groups: [], search: {} }).overview,
  ).toMatchObject({ total: 0, matched: 0, sections: [] })
})
it('pages open rows without repeating a folded staff head', () => {
  const people = Array.from({ length: 5 }, (_, n) =>
    overviewRow(`person-${n}`, { kind: 'personal', group }),
  )
  const rooms = Array.from({ length: 3 }, (_, n) => overviewRow(`room-${n}`))
  const rows = [...people, ...rooms]
  const pages = [1, 2].map((page) =>
    buildPortalOverview(rows, { page, sort: 'name' }, [], 2),
  )
  expect(pages.map((page) => page.lastPage)).toEqual([2, 2])
  expect(
    pages
      .flatMap((page) => page.sections)
      .filter((section) => section.group?.id === group.id),
  ).toHaveLength(1)
  expect(
    pages.flatMap((page) =>
      page.sections.flatMap((section) => section.items.map((item) => item.row.portalId)),
    ),
  ).toEqual(rooms.map((row) => row.portalId))
  const all = [1, 2].map((page) =>
    buildAllPropertiesOverview(rows, [], { page, sort: 'name' }, [], 2),
  )
  expect(
    all
      .flatMap((page) => page.properties.flatMap((property) => property.sections))
      .filter((section) => section.group?.id === group.id),
  ).toHaveLength(1)
})
it('orders people alphabetically across real page boundaries, after places', () => {
  const rows = ['Zoe', 'Ana', 'Mia'].map((name) =>
    overviewRow(name, { kind: 'personal', name, group }),
  )
  const pages = [1, 2].map((page) =>
    buildPortalOverview(
      [overviewRow('room', { group }), ...rows],
      { page, sort: 'scans', dir: 'desc' },
      [],
      2,
      { portal: (id) => (id === 'Zoe' ? 99 : 1), group: () => 1 },
      [],
      { [group.id]: false },
    ),
  )
  expect(
    pages.flatMap((page) =>
      page.sections.flatMap((section) => section.items.map((item) => item.row.name)),
    ),
  ).toEqual(['room', 'Ana', 'Mia', 'Zoe'])
})
