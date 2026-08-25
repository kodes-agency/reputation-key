import type { QueryClient } from '@tanstack/react-query'
import { identityKeys } from '#/shared/queries/query-keys'

/** Query-owned organization identity appears in settings and app-shell reads. */
export const organizationCachePolicy = {
  async onOrganizationUpdated(queryClient: QueryClient): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: identityKeys.activeOrg() }),
      queryClient.invalidateQueries({ queryKey: identityKeys.organizations() }),
    ])
  },
} as const
