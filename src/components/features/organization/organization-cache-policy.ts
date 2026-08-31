import type { QueryClient } from '@tanstack/react-query'
import { identityKeys } from '#/shared/queries/query-keys'

/** The active beta Organization is the only query-owned organization identity. */
export const organizationCachePolicy = {
  async onOrganizationUpdated(queryClient: QueryClient): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: identityKeys.activeOrg() })
  },
} as const
