import { queryOptions } from '@tanstack/react-query'
import { productUpdateKeys } from '#/shared/queries/query-keys'
import type { ProductUpdatesClientGetter } from '#/shared/whats-new/types'

export const productUpdatesQuery = (
  propertyId: string | null,
  getClient: ProductUpdatesClientGetter,
) =>
  queryOptions({
    queryKey: productUpdateKeys.scope(propertyId),
    queryFn: async () =>
      (await getClient()).get({ data: { propertyId: propertyId ?? undefined } }),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
