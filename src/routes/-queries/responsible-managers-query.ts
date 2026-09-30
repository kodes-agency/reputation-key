// One Property's Responsible managers. Shared by the Property settings sections
// and the Members access sheet, so both read (and invalidate) the same cache
// entry under propertyKeys.responsibleManagers.
//
// Its own module, not route-queries.ts: that file backs the authenticated
// layout, so anything added there rides in every page's chunk, while this read
// is only ever needed by the routes that import it.

import { queryOptions } from '@tanstack/react-query'
import { listPropertyResponsibleManagers } from '#/contexts/property/server/property-responsible-managers'
import { propertyKeys } from '#/shared/queries/query-keys'

export const responsibleManagersQuery = (propertyId: string) =>
  queryOptions({
    queryKey: propertyKeys.responsibleManagers(propertyId),
    queryFn: () => listPropertyResponsibleManagers({ data: { propertyId } }),
    staleTime: 30_000,
  })
