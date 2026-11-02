import { it, expect } from 'vitest'
import { staffPortalCounts } from './portal-goal-staff-counts'
it('keeps place contributions and combines staff into the hotel number', () => {
  expect(
    staffPortalCounts([
      { portalId: 'a', name: 'Ana', count: 7, kind: 'personal' },
      { portalId: 'l', name: 'Lobby', count: 10 },
      { portalId: 'b', name: 'Bob', count: 3, kind: 'personal' },
    ]),
  ).toEqual([
    { portalId: 'l', name: 'Lobby', count: 10 },
    { portalId: 'staff-portals', name: 'Staff portals: 2', count: 10 },
  ])
})
