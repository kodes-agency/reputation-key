import type { QueryClient } from '@tanstack/react-query'
import { createKeys } from '#/shared/queries/query-keys'
import type { TenantScope } from '#/shared/queries/tenant-scope'
import type { ProductUpdatesView } from '#/shared/whats-new/types'

/** The toggle waits while saving, so a refusal can restore this exact snapshot. */
export function optimisticAutoShow(
  client: QueryClient,
  scope: TenantScope,
  autoShow: boolean,
) {
  const { productUpdateKeys } = createKeys(scope)
  void client.cancelQueries({ queryKey: productUpdateKeys.all })
  const cache = client.getQueryCache()
  const previous = cache.findAll({ queryKey: productUpdateKeys.all }).map((query) => ({
    query,
    view: client.getQueryData<ProductUpdatesView>(query.queryKey),
  }))
  client.setQueriesData<ProductUpdatesView>(
    { queryKey: productUpdateKeys.all },
    (view) =>
      view && {
        ...view,
        autoShow,
        shouldAutoOpen: autoShow && view.shouldAutoOpen,
      },
  )
  return () => {
    // Teardown removes these Query instances; a late refusal must not restore them.
    for (const { query, view } of previous)
      if (view && cache.get(query.queryHash) === query)
        client.setQueryData(query.queryKey, view)
  }
}
