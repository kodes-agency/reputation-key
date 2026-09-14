// Cross-cutting route-data query options shared by the parent layout loaders
// (_authenticated, properties/$propertyId) and their many consumers. Defined
// here once so the loader (ensureQueryData) and every consumer (useSuspenseQuery)
// reference the SAME options object — the contract that makes the loader-primed
// cache hit with zero extra fetch. Keys live in #/shared/queries/query-keys.
//
// These mirror the inline queryOptions the leaf routes define for their own data;
// they are hoisted here only because the parent-layout data is consumed across
// many sibling routes (DRY).
//
// BQC-5.1: lives under routes/-queries (route-layer plumbing) because it imports
// context server functions — shared/ must not depend on context implementations.

import { getReviewAnalysisProgressFn } from '#/contexts/ai/server/review-analysis'
import { getOrganizationAiSpendFn } from '#/contexts/ai/server/organization-ai-spend'
import { listMerchantAiOverviewFn } from '#/contexts/identity/server/merchant-ai'
import {
  getPropertySetupFn,
  listPropertySetupSummariesFn,
} from '#/contexts/reporting/server/property-setup'
import { queryOptions } from '@tanstack/react-query'
import { listProperties, getProperty } from '#/contexts/property/server/properties'
import { listMembers } from '#/contexts/identity/server/organizations'
import { aiKeys, identityKeys, propertyKeys } from '#/shared/queries/query-keys'
// Structural property data consumed by the app shell and sibling routes.
// Rarely changes; 5-min staleTime.

export const propertiesQuery = queryOptions({
  queryKey: propertyKeys.list(),
  queryFn: () => listProperties(),
  staleTime: 5 * 60 * 1000,
})

export const membersQuery = queryOptions({
  queryKey: identityKeys.members(),
  queryFn: () => listMembers(),
  staleTime: 30_000,
})

// A single property — consumed by the property layout + 9 property-scoped routes.
export function propertyQuery(propertyId: string) {
  return queryOptions({
    queryKey: propertyKeys.detail(propertyId),
    queryFn: () => getProperty({ data: { propertyId } }),
    staleTime: 60_000,
  })
}

export function propertySetupQuery(propertyId: string) {
  return queryOptions({
    queryKey: propertyKeys.setup(propertyId),
    queryFn: () => getPropertySetupFn({ data: { propertyId } }),
    staleTime: 30_000,
  })
}

export const propertySetupSummariesQuery = queryOptions({
  queryKey: propertyKeys.setupSummaries(),
  queryFn: () => listPropertySetupSummariesFn(),
  staleTime: 30_000,
  retry: false,
})

export function reviewAnalysisProgressQuery(propertyId: string) {
  return queryOptions({
    queryKey: aiKeys.reviewAnalysisProgress(propertyId),
    queryFn: () => getReviewAnalysisProgressFn({ data: { propertyId } }),
    staleTime: 10_000,
    // While history is being read the counts move every few seconds.
    refetchInterval: (query) =>
      query.state.data?.status === 'analysing' ? 15_000 : false,
  })
}

export const merchantAiOverviewQuery = queryOptions({
  queryKey: identityKeys.merchantAiOverview(),
  queryFn: () => listMerchantAiOverviewFn(),
  staleTime: 30_000,
})

export const organizationAiSpendQuery = queryOptions({
  queryKey: aiKeys.organizationSpend(),
  queryFn: () => getOrganizationAiSpendFn(),
  staleTime: 60_000,
})
