import type { ProductUpdatesClientGetter } from '#/shared/whats-new/types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { SettingSwitchRow } from '#/components/forms/setting-switch-row'
import { RegionError } from '#/components/ui/region-error'
import { hasFailed, isRetrying } from '#/components/hooks/is-retrying'
import {
  useActionMutation,
  actionFailureMessage,
} from '#/components/hooks/use-action-mutation'
import type { Action } from '#/components/hooks/use-action'
import { usePropertyId } from '#/components/hooks/use-property-id'
import { productUpdateKeys } from '#/shared/queries/query-keys'
import { productUpdatesQuery } from './queries'

import { optimisticAutoShow } from './preferences-cache'

export function ProductUpdatePreferencesCard({
  autoShow,
  save,
}: Readonly<{ autoShow: boolean; save: Action<boolean, void> }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Product updates</CardTitle>
      </CardHeader>
      <CardContent>
        <SettingSwitchRow
          id="product-updates-auto-show"
          label="Show updates automatically"
          description="Open What's new by itself when something important changes. You can always find updates in the account menu."
          checked={autoShow}
          commit="immediate"
          pending={save.isPending}
          onCheckedChange={save}
        />
      </CardContent>
    </Card>
  )
}

export function ProductUpdatePreferences({
  getClient,
}: Readonly<{ getClient: ProductUpdatesClientGetter }>) {
  const client = useQueryClient()
  const query = useQuery(productUpdatesQuery(usePropertyId(), getClient))
  const save = useActionMutation(
    async (autoShow: boolean) => (await getClient()).setAutoShow({ data: { autoShow } }),
    {
      errorMessage: actionFailureMessage("Couldn't save your update preference."),
      optimistic: (autoShow) => optimisticAutoShow(client, autoShow),
      invalidateKeys: [productUpdateKeys.all],
    },
  )
  if (hasFailed(query))
    return (
      <RegionError
        message="Your update preference couldn’t be loaded."
        retrying={isRetrying(query)}
        onRetry={() => void query.refetch()}
      />
    )
  if (!query.data)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading update preference…
      </p>
    )
  return <ProductUpdatePreferencesCard autoShow={query.data.autoShow} save={save} />
}
