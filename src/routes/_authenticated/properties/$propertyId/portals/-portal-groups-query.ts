// The property's portal groups, read by the list route and by the portal
// editor (its Group section). One definition, because both share the cache key.
import { queryOptions } from '@tanstack/react-query'
import { listPortalGroups } from '#/contexts/portal/server/portal-groups'
import { portalKeys } from '#/shared/queries/query-keys'

export const portalGroupsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: portalKeys.groups(propertyId),
    queryFn: () => listPortalGroups({ data: { propertyId } }),
    staleTime: 30_000,
  })
