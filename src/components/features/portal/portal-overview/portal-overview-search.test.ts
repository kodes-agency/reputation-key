// The Portals lists search with the same folded matcher as the Properties list:
// "cafe" finds "Café", "CAFÉ" finds "Cafe". They used to lowercase only, so the
// same word found a name on one page and missed it on the next.
import { describe, expect, it } from 'vitest'
import { propertyId } from '#/shared/domain/ids'
import {
  allPropertiesMembers,
  allPropertiesProperties,
  allPropertiesRows,
} from './portal-all-properties-fixtures'
import { buildAllPropertiesOverview } from './portal-all-properties-view'
import { overviewGroup, overviewRow } from './portal-overview-fixtures'
import { buildPortalOverview } from './portal-overview-view'

describe('Portals list search', () => {
  const front = overviewGroup('g-front', 'Front of house')
  const rows = [
    overviewRow('p-cafe', { name: 'Café Plaza', group: front }),
    overviewRow('p-plain', { name: 'Cafe Terrace' }),
    overviewRow('p-other', { name: 'Reception' }),
  ]
  const search = (q: string) =>
    buildPortalOverview(rows, { q }, [], 20).sections.flatMap((section) =>
      section.items.map((item) => item.row.name),
    )

  it('finds an accented name from the plain query, and the reverse', () => {
    expect(search('cafe').sort()).toEqual(['Cafe Terrace', 'Café Plaza'])
    expect(search('CAFÉ').sort()).toEqual(['Cafe Terrace', 'Café Plaza'])
  })

  it('folds the group name the same way', () => {
    expect(search('FRONT of hóuse')).toEqual(['Café Plaza'])
  })

  it('still matches nothing for a word that is not there', () => {
    expect(search('zzz')).toEqual([])
  })
})

describe('All properties search', () => {
  const cafe = propertyId('prop-cafe')
  const rows = [
    overviewRow('c-bar', { propertyId: cafe, name: 'Bar Étage' }),
    overviewRow('c-lobby', { propertyId: cafe, name: 'Lobby' }),
    ...allPropertiesRows(),
  ]
  const properties = [
    ...allPropertiesProperties,
    { id: cafe, name: 'Café Plaza', googleBindingState: 'active' as const },
  ]
  const search = (q: string) =>
    buildAllPropertiesOverview(rows, properties, { q }, allPropertiesMembers)
  const portalNames = (page: ReturnType<typeof search>) =>
    page.properties.map((property) =>
      property.sections.flatMap((section) => section.items.map((item) => item.row.name)),
    )

  it('finds a Portal by a name with an accent in it', () => {
    expect(portalNames(search('etage'))).toEqual([['Bar Étage']])
  })

  it('finds a Property by its accented name and keeps all its Portals', () => {
    const page = search('CAFE')
    expect(page.properties.map((property) => property.name)).toEqual(['Café Plaza'])
    expect(portalNames(page)).toEqual([['Bar Étage', 'Lobby']])
  })
})
