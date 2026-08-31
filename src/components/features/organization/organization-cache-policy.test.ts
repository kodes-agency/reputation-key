import { describe, expect, it } from 'vitest'
import type { QueryClient } from '@tanstack/react-query'
import { identityKeys } from '#/shared/queries/query-keys'
import { organizationCachePolicy } from './organization-cache-policy'

describe('organizationCachePolicy.onOrganizationUpdated', () => {
  it('refreshes the active beta organization', async () => {
    const invalidated: ReadonlyArray<unknown>[] = []
    const queryClient = {
      invalidateQueries: (filters: { queryKey: ReadonlyArray<unknown> }) => {
        invalidated.push(filters.queryKey)
        return Promise.resolve()
      },
    } as unknown as QueryClient

    await organizationCachePolicy.onOrganizationUpdated(queryClient)

    expect(invalidated).toEqual([identityKeys.activeOrg()])
  })
})
