import { type TenantScope } from '#/shared/queries/tenant-scope'
import type { QueryClient } from '@tanstack/react-query'
import { createKeys } from '#/shared/queries/query-keys'
import { invalidateShellContext } from '#/shared/queries/shell-context-cache'

/** The active beta Organization is the only query-owned organization identity. */
export const organizationCachePolicy = {
  async onOrganizationUpdated(
    queryClient: QueryClient,
    scope: TenantScope,
  ): Promise<void> {
    // The sidebar names the Organization from the shell's remembered answer, so the
    // next navigation must ask again rather than show the old name.
    invalidateShellContext(queryClient)
    await queryClient.invalidateQueries({
      queryKey: createKeys(scope).identityKeys.activeOrg(),
    })
  },
} as const
