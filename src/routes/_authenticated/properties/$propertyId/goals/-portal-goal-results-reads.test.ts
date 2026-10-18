// The Portal goal results page's reads, defined in `-portal-goal-queries.ts`
// beside the Monthly portal goal's (PLAN PG-18).
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { goalKeys, portalKeys } from '#/shared/queries/query-keys'

const mocks = vi.hoisted(() => ({
  listGoalPrograms: vi.fn(),
  listPortalGroups: vi.fn(),
  listPortals: vi.fn(),
}))

vi.mock('#/contexts/reporting/server/goal-programs', () => ({
  listGoalPrograms: mocks.listGoalPrograms,
}))
vi.mock('#/contexts/portal/server/portal-groups', () => ({
  listPortalGroups: mocks.listPortalGroups,
}))
vi.mock('#/contexts/portal/server/portals', () => ({
  listPortals: mocks.listPortals,
}))

import {
  portalGoalResultsQueries,
  prefetchPortalGoalResults,
} from './-portal-goal-queries'

const PROPERTY = 'property-1'

describe('the Portal goal results reads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listGoalPrograms.mockResolvedValue({ programs: [] })
    mocks.listPortalGroups.mockResolvedValue({ groups: [{ id: 'g1', name: 'Rooms' }] })
    mocks.listPortals.mockResolvedValue({ portals: [{ id: 'p1', name: 'Reception' }] })
  })

  it('primes the goals and their subjects’ names under the keys the Goals page reads', async () => {
    const queryClient = new QueryClient()

    await prefetchPortalGoalResults(queryClient, PROPERTY)

    for (const read of [
      mocks.listGoalPrograms,
      mocks.listPortalGroups,
      mocks.listPortals,
    ]) {
      expect(read).toHaveBeenCalledWith({ data: { propertyId: PROPERTY } })
    }
    expect(
      queryClient.getQueryData(goalKeys.list({ propertyId: PROPERTY, model: 'program' })),
    ).toEqual({ programs: [] })
    expect(queryClient.getQueryData(portalKeys.goalSubjectNames(PROPERTY))).toEqual({
      groups: [{ id: 'g1', name: 'Rooms' }],
      portals: [{ id: 'p1', name: 'Reception' }],
    })
  })

  it('reads nothing again for a page the Goals page has just read', async () => {
    const queryClient = new QueryClient()
    const queries = portalGoalResultsQueries(PROPERTY)
    queryClient.setQueryData(queries.goals.queryKey, { programs: [] })
    queryClient.setQueryData(queries.subjectNames.queryKey, { groups: [], portals: [] })

    await prefetchPortalGoalResults(queryClient, PROPERTY)

    expect(mocks.listGoalPrograms).not.toHaveBeenCalled()
    expect(mocks.listPortals).not.toHaveBeenCalled()
  })

  it('fails the page when its goals cannot be read', async () => {
    mocks.listGoalPrograms.mockRejectedValueOnce(new Error('unavailable'))

    await expect(prefetchPortalGoalResults(new QueryClient(), PROPERTY)).rejects.toThrow(
      'unavailable',
    )
  })
})
