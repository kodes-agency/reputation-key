import type { ProductUpdatesClientGetter } from '#/shared/whats-new/types'
import { useQueryClient } from '@tanstack/react-query'
import { createKeys } from '#/shared/queries/query-keys'
import { useTenantScope } from '#/shared/hooks/useTenantScope'
import {
  useActionMutation,
  actionFailureMessage,
} from '#/components/hooks/use-action-mutation'

export function useMarkProductUpdatesSeen(
  propertyId: string | null,
  getClient: ProductUpdatesClientGetter,
) {
  const client = useQueryClient()
  const { productUpdateKeys } = createKeys(useTenantScope())
  return useActionMutation(
    async (entryIds: readonly string[]) =>
      (await getClient()).markSeen({
        data: { entryIds: [...entryIds], propertyId: propertyId ?? undefined },
      }),
    {
      errorMessage: actionFailureMessage("Couldn't remember these updates."),
      onSuccess: () => client.invalidateQueries({ queryKey: productUpdateKeys.all }),
    },
  )
}
