import { queryOptions } from '@tanstack/react-query'
import { getMerchantAiAuthorizationFn } from '#/contexts/identity/server/merchant-ai'
import { listPropertyResponsibleManagers } from '#/contexts/property/server/property-responsible-managers'
import { getResponseTargetPolicySettingsFn } from '#/contexts/inbox/server/inbox'
import { getPropertyPortalExperience } from '#/contexts/portal/server/portals'
import { getPropertyReplyLibraryFn } from '#/contexts/review/server/reply'
import {
  identityKeys,
  inboxKeys,
  portalKeys,
  propertyKeys,
  reviewKeys,
} from '#/shared/queries/query-keys'

/** Queries the property settings sections share; each section loads only its own. */
export const responsibleManagersQuery = (propertyId: string) =>
  queryOptions({
    queryKey: propertyKeys.responsibleManagers(propertyId),
    queryFn: () => listPropertyResponsibleManagers({ data: { propertyId } }),
    staleTime: 30_000,
  })

export const responseTargetPolicyQuery = (propertyId: string) =>
  queryOptions({
    queryKey: inboxKeys.responseTargetPolicies(propertyId),
    queryFn: () => getResponseTargetPolicySettingsFn({ data: { propertyId } }),
    staleTime: 60_000,
  })

export const propertyPortalExperienceQuery = (propertyId: string) =>
  queryOptions({
    queryKey: portalKeys.propertyExperience(propertyId),
    queryFn: () => getPropertyPortalExperience({ data: { propertyId } }),
    staleTime: 30_000,
  })

export const propertyReplyLibraryQuery = (propertyId: string) =>
  queryOptions({
    queryKey: reviewKeys.replyLibrary(propertyId),
    queryFn: () => getPropertyReplyLibraryFn({ data: { propertyId } }),
    staleTime: 30_000,
  })

export const merchantAiAuthorizationQuery = (propertyId: string) =>
  queryOptions({
    queryKey: identityKeys.merchantAiAuthorization(propertyId),
    queryFn: () => getMerchantAiAuthorizationFn({ data: { propertyId } }),
    staleTime: 0,
  })

// Re-exported, not redefined: the people section reads the same members cache as
// the inbox and portal routes, and a second copy of these options could drift
// from their key or staleTime without anything noticing.
export {
  membersQuery,
  reviewAnalysisProgressQuery,
} from '#/routes/-queries/route-queries'
