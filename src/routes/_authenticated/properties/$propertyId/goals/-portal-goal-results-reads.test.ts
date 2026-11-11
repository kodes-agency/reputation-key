// The Portal goal results page's reads, defined in `-portal-goal-queries.ts`
// beside the Monthly portal goal's.
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { goalKeys, portalKeys } from '#/shared/queries/query-keys'

const mocks = vi.hoisted(() => ({
  listGoalPrograms: vi.fn(),
  getGoalProgramHistory: vi.fn(),
  listPortalGroups: vi.fn(),
  listPortals: vi.fn(),
}))

vi.mock('#/contexts/reporting/server/goal-programs', () => ({
  listGoalPrograms: mocks.listGoalPrograms,
  getGoalProgramHistory: mocks.getGoalProgramHistory,
}))
vi.mock('#/contexts/portal/server/portal-groups', () => ({
  listPortalGroups: mocks.listPortalGroups,
}))
vi.mock('#/contexts/portal/server/portals', () => ({
  listPortals: mocks.listPortals,
}))

import {
  markPortalGoalAddedStale,
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

  it('loads every history page even when the summary list is already fresh', async () => {
    const queryClient = new QueryClient()
    const program = {
      program: { id: 'goal-1' },
      versions: [],
      assignments: [],
      results: [],
      targetChanges: [],
    }
    queryClient.setQueryData(goalKeys.list({ propertyId: PROPERTY, model: 'program' }), {
      programs: [program],
    })
    const next = { periodStart: new Date('2026-03-01Z'), id: 'month-3' }
    mocks.getGoalProgramHistory
      .mockResolvedValueOnce({
        results: [{ id: 'month-3', periodStart: next.periodStart }],
        targetProvenance: {
          older: {
            setAt: new Date('2025-12-10Z'),
            setBy: 'first-manager',
            countsFrom: new Date('2026-01-01Z'),
          },
        },
        versions: [],
        assignments: [],
        targetChanges: [],
        next,
      })
      .mockResolvedValueOnce({
        results: [
          { id: 'month-2', periodStart: new Date('2026-02-01Z') },
          { id: 'month-1', periodStart: new Date('2026-01-01Z') },
        ],
        versions: [],
        assignments: [],
        targetChanges: [],
        next: null,
      })
    await prefetchPortalGoalResults(queryClient, PROPERTY)
    const data = queryClient.getQueryData<{
      programs: Array<{ results: Array<{ id: string }> }>
    }>(portalGoalResultsQueries(PROPERTY).goals.queryKey)
    expect(data?.programs[0]?.results.map((result) => result.id)).toEqual([
      'month-1',
      'month-2',
      'month-3',
    ])
    expect(
      queryClient.getQueryData<{ programs: Array<{ targetProvenance?: unknown }> }>(
        portalGoalResultsQueries(PROPERTY).goals.queryKey,
      )?.programs[0]?.targetProvenance,
    ).toEqual({
      older: {
        setAt: new Date('2025-12-10Z'),
        setBy: 'first-manager',
        countsFrom: new Date('2026-01-01Z'),
      },
    })
    expect(mocks.getGoalProgramHistory).toHaveBeenCalledWith({
      data: { propertyId: PROPERTY, programId: 'goal-1', after: next },
    })
    expect(mocks.listGoalPrograms).not.toHaveBeenCalled()
  })

  it.each(['invalidated', 'expired'] as const)(
    'refreshes %s summaries before caching history so newly added goals are included',
    async (cacheState) => {
      const queryClient = new QueryClient()
      const summaryKey = goalKeys.list({ propertyId: PROPERTY, model: 'program' })
      const existing = {
        program: { id: 'goal-1' },
        versions: [],
        assignments: [],
        results: [],
        targetChanges: [],
      }
      const added = { ...existing, program: { id: 'goal-2' } }
      queryClient.setQueryData(
        summaryKey,
        { programs: [existing] },
        { updatedAt: Date.now() - (cacheState === 'expired' ? 60_000 : 0) },
      )
      if (cacheState === 'invalidated') {
        await markPortalGoalAddedStale(queryClient, PROPERTY, ['portal:portal-2'])
      }
      mocks.listGoalPrograms.mockResolvedValue({ programs: [existing, added] })
      mocks.getGoalProgramHistory.mockResolvedValue({
        results: [],
        versions: [],
        assignments: [],
        targetChanges: [],
        next: null,
      })

      await prefetchPortalGoalResults(queryClient, PROPERTY)

      const history = queryClient.getQueryData<{
        programs: Array<{ program: { id: string } }>
      }>(portalGoalResultsQueries(PROPERTY).goals.queryKey)
      expect(history?.programs.map(({ program }) => program.id)).toEqual([
        'goal-1',
        'goal-2',
      ])
      expect(mocks.listGoalPrograms).toHaveBeenCalledExactlyOnceWith({
        data: { propertyId: PROPERTY },
      })
      expect(queryClient.getQueryData(summaryKey)).toEqual({
        programs: [existing, added],
      })
      expect(mocks.getGoalProgramHistory).toHaveBeenCalledTimes(2)
      expect(mocks.getGoalProgramHistory).toHaveBeenCalledWith({
        data: { propertyId: PROPERTY, programId: 'goal-2', after: undefined },
      })
    },
  )

  it('fails the page when its goals cannot be read', async () => {
    mocks.listGoalPrograms.mockRejectedValueOnce(new Error('unavailable'))

    await expect(prefetchPortalGoalResults(new QueryClient(), PROPERTY)).rejects.toThrow(
      'unavailable',
    )
  })
})
