import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { identityKeys } from '#/shared/queries/query-keys'
import { shellContextKeys } from '#/shared/queries/shell-context-cache'
import { organizationCachePolicy } from './organization-cache-policy'

describe('organizationCachePolicy.onOrganizationUpdated', () => {
  it('refreshes the active beta organization', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(identityKeys.activeOrg(), { organization: { name: 'Old' } })

    await organizationCachePolicy.onOrganizationUpdated(queryClient)

    expect(queryClient.getQueryState(identityKeys.activeOrg())?.isInvalidated).toBe(true)
  })

  // The sidebar names the Organization from the shell's remembered answer (ADR 0072).
  it("forgets the shell's remembered Organization, so the next page shows the new name", async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(shellContextKeys.session(), { user: { id: 'user-1' } })
    queryClient.setQueryData(shellContextKeys.organization('user-1'), { name: 'Old' })

    await organizationCachePolicy.onOrganizationUpdated(queryClient)

    expect(
      queryClient.getQueryCache().findAll({ queryKey: shellContextKeys.all }),
    ).toEqual([])
  })
})
