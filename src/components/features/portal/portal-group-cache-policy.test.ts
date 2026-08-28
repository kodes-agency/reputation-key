import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { portalKeys } from '#/shared/queries/query-keys'
import { portalGroupCachePolicy } from './portal-group-cache-policy'

const PROPERTY_ID = 'property-1'

type Invalidation = Readonly<{
  queryKey: ReadonlyArray<unknown>
  exact?: boolean
}>

function recordingQueryClient(invalidated: Invalidation[]): QueryClient {
  return {
    invalidateQueries: (filters: Invalidation) => {
      invalidated.push(filters)
      return Promise.resolve()
    },
  } as unknown as QueryClient
}

describe('portalGroupCachePolicy', () => {
  const mutationPolicies = [
    ['created', portalGroupCachePolicy.onGroupCreated],
    ['renamed', portalGroupCachePolicy.onGroupUpdated],
    ['archived', portalGroupCachePolicy.onGroupDeleted],
    ['member added', portalGroupCachePolicy.onGroupMemberAdded],
    ['member removed', portalGroupCachePolicy.onGroupMemberRemoved],
  ] as const

  it.each(mutationPolicies)(
    'refreshes every property-scoped group projection after a group is %s',
    async (_label, refresh) => {
      const invalidated: Invalidation[] = []

      await refresh(recordingQueryClient(invalidated), PROPERTY_ID)

      expect(invalidated).toEqual([
        { queryKey: portalKeys.groups(PROPERTY_ID), exact: true },
        { queryKey: portalKeys.goalSubjects(PROPERTY_ID), exact: true },
        { queryKey: portalKeys.goalSubjectNames(PROPERTY_ID), exact: true },
      ])
    },
  )

  it('marks only the affected Property projections stale', async () => {
    const queryClient = new QueryClient()
    const affected = [
      portalKeys.groups(PROPERTY_ID),
      portalKeys.goalSubjects(PROPERTY_ID),
      portalKeys.goalSubjectNames(PROPERTY_ID),
    ]
    const unaffected = [
      portalKeys.list(PROPERTY_ID),
      portalKeys.groups('property-2'),
      portalKeys.goalSubjects('property-2'),
      portalKeys.goalSubjectNames('property-2'),
    ]
    for (const queryKey of [...affected, ...unaffected]) {
      queryClient.setQueryData(queryKey, { loaded: true })
    }

    await portalGroupCachePolicy.onGroupUpdated(queryClient, PROPERTY_ID)

    expect(
      affected.map((queryKey) => queryClient.getQueryState(queryKey)?.isInvalidated),
    ).toEqual([true, true, true])
    expect(
      unaffected.map((queryKey) => queryClient.getQueryState(queryKey)?.isInvalidated),
    ).toEqual([false, false, false, false])
  })
})
