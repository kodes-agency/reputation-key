import { queryOptions } from '@tanstack/react-query'
import { createKeys } from '#/shared/queries/query-keys'
import type { TenantScope } from '#/shared/queries/tenant-scope'
import type { ProductUpdatesClientGetter } from '#/shared/whats-new/types'

export const productUpdatesQuery = (
  scope: TenantScope,
  propertyId: string | null,
  getClient: ProductUpdatesClientGetter,
) =>
  queryOptions({
    queryKey: createKeys(scope).productUpdateKeys.scope(propertyId),
    queryFn: async () =>
      (await getClient()).get({ data: { propertyId: propertyId ?? undefined } }),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
