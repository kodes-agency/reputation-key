// Cross-cutting route-data query options shared by the parent layout loaders
// (_authenticated, properties/$propertyId) and their many consumers. Defined
// here once so the loader (ensureQueryData) and every consumer (useSuspenseQuery)
// reference the SAME options object — the contract that makes the loader-primed
// cache hit with zero extra fetch. Keys live in ./query-keys.ts.
//
// These mirror the inline queryOptions the leaf routes define for their own data;
// they are hoisted here only because the parent-layout data is consumed across
// many sibling routes (DRY).

import { queryOptions } from '@tanstack/react-query'
import { listUserOrganizations } from '#/contexts/identity/server/organizations'
import { listProperties, getProperty } from '#/contexts/property/server/properties'
import { identityKeys, propertyKeys } from './query-keys'
// Structural data (orgs + the user's property list) — consumed by the app shell
// sidebars + 7 sibling routes. Rarely changes; 5-min staleTime.
export const organizationsQuery = queryOptions({
  queryKey: identityKeys.organizations(),
  queryFn: () => listUserOrganizations(),
  staleTime: 5 * 60 * 1000,
})

export const propertiesQuery = queryOptions({
  queryKey: propertyKeys.list(),
  queryFn: () => listProperties(),
  staleTime: 5 * 60 * 1000,
})

// A single property — consumed by the property layout + 9 property-scoped routes.
export function propertyQuery(propertyId: string) {
  return queryOptions({
    queryKey: propertyKeys.detail(propertyId),
    queryFn: () => getProperty({ data: { propertyId } }),
    staleTime: 60_000,
  })
}
