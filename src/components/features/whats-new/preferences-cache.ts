import type { QueryClient } from '@tanstack/react-query'
import { productUpdateKeys } from '#/shared/queries/query-keys'
import type { ProductUpdatesView } from '#/shared/whats-new/types'

/** The toggle waits while saving, so a refusal can restore this exact snapshot. */
export function optimisticAutoShow(client: QueryClient, autoShow: boolean) {
  void client.cancelQueries({ queryKey: productUpdateKeys.all })
  const previous = client.getQueriesData<ProductUpdatesView>({
    queryKey: productUpdateKeys.all,
  })
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
    for (const [key, view] of previous) if (view) client.setQueryData(key, view)
  }
}
