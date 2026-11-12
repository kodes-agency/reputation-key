import type { TenantScope } from '#/shared/queries/tenant-scope'
import { useTenantScope } from '#/shared/hooks/useTenantScope'
import { notFound } from '@tanstack/react-router'
import { queryOptions, useQueries, type QueryClient } from '@tanstack/react-query'
import {
  getPropertyPortalExperience,
  getPortal,
  getPortalPublicationHistory,
  listPortals,
  listPortalApprovedDestinations,
} from '#/contexts/portal/server/portals'
import { getPortalLinktree, listPortalLinks } from '#/contexts/portal/server/portal-links'
import { getPortalReview } from '#/contexts/portal/server/portal-review'
import { getPortalLanguageCoverage } from '#/contexts/portal/server/portal-language-coverage'
import { listPortalGroups } from '#/contexts/portal/server/portal-groups'
import { listPortalResponsibleManagers } from '#/contexts/portal/server/portal-responsible-managers'
import { portalKeys } from '#/shared/queries/query-keys'
import { membersQuery } from '#/routes/-queries/route-queries'
import type {
  Portal,
  PortalTokenStatus,
} from '#/contexts/portal/application/portal-management-contracts'

export type PortalQueryResult = Readonly<{
  portal: Portal | null
  tokenStatus: PortalTokenStatus
}>

export const portalQuery = (portalId: string) =>
  queryOptions({
    queryKey: portalKeys.detail(portalId),
    queryFn: () => getPortal({ data: { portalId } }),
    staleTime: 30_000,
  })

// The property's portal groups, read by the list route and by the portal
// editor (its Group section). One definition, because both share the cache key.
export const portalGroupsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: portalKeys.groups(propertyId),
    queryFn: () => listPortalGroups({ data: { propertyId } }),
    staleTime: 30_000,
  })

const propertyPortalsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: portalKeys.list(propertyId),
    queryFn: () => listPortals({ data: { propertyId } }),
    staleTime: 30_000,
  })

const portalLinksQuery = (portalId: string) =>
  queryOptions({
    queryKey: portalKeys.links(portalId),
    queryFn: () => listPortalLinks({ data: { portalId } }),
    staleTime: 30_000,
  })

const portalLanguageCoverageQuery = (propertyId: string, portalId: string) =>
  queryOptions({
    queryKey: portalKeys.languageCoverage(propertyId, portalId),
    queryFn: () => getPortalLanguageCoverage({ data: { portalId } }),
    staleTime: 30_000,
  })

const portalLinktreeQuery = (portalId: string) =>
  queryOptions({
    queryKey: portalKeys.linktree(portalId),
    queryFn: () => getPortalLinktree({ data: { portalId } }),
    staleTime: 30_000,
  })

export const responsibleManagersQuery = (portalId: string) =>
  queryOptions({
    queryKey: portalKeys.responsibleManagers(portalId),
    queryFn: () => listPortalResponsibleManagers({ data: { portalId } }),
    staleTime: 30_000,
  })

export const portalPublicationHistoryQuery = (portalId: string) =>
  queryOptions({
    queryKey: portalKeys.publicationHistory(portalId),
    queryFn: () => getPortalPublicationHistory({ data: { portalId } }),
    staleTime: 30_000,
  })

/**
 * What Review & publish shows. The route's loader fetches it afresh on every
 * entry (a review of stale facts is worse than none); the page then reads it
 * from the cache, and every working-copy write or publication invalidates it.
 */
export const portalReviewQuery = (portalId: string) =>
  queryOptions({
    queryKey: portalKeys.review(portalId),
    queryFn: () => getPortalReview({ data: { portalId } }),
    staleTime: 30_000,
  })

const portalExperienceQuery = (propertyId: string, portalId: string) =>
  queryOptions({
    queryKey: portalKeys.experience(propertyId, portalId),
    queryFn: () => getPropertyPortalExperience({ data: { propertyId, portalId } }),
    staleTime: 30_000,
  })

const portalApprovedDestinationsQuery = (portalId: string) =>
  queryOptions({
    queryKey: portalKeys.approvedDestinations(portalId),
    queryFn: () => listPortalApprovedDestinations({ data: { portalId } }),
    staleTime: 30_000,
  })

/**
 * Resolve the portal through the URL property's AUTHORIZED collection, so a
 * portal in another property or organization is reported exactly like one that
 * no longer exists — a direct URL never reveals that it exists elsewhere.
 *
 * The list is refetched ONCE before concluding the portal is gone. `invalidate`
 * after a create only refetches ACTIVE queries, and this list has no observer
 * while the user is on the Portals overview (the New portal dialog creates from
 * there), so the cache still held the pre-creation list: a portal created a second earlier was reported unavailable.
 * The refetch costs nothing in the happy path — it runs only on a cache miss —
 * and removes that whole class of false negative for any stale list.
 */
const findAuthorizedPortal = async (
  queryClient: QueryClient,
  propertyId: string,
  portalId: string,
): Promise<Portal | null> => {
  const options = propertyPortalsQuery(propertyId)
  const cached = await queryClient.ensureQueryData(options)
  const hit = cached.portals.find((candidate) => String(candidate.id) === portalId)
  if (hit) return hit
  const fresh = await queryClient.fetchQuery({ ...options, staleTime: 0 })
  return fresh.portals.find((candidate) => String(candidate.id) === portalId) ?? null
}

/** Authorize through the URL property before reading the Portal itself. */
export async function loadPortalWorkspace(
  queryClient: QueryClient,
  propertyId: string,
  portalId: string,
): Promise<void> {
  if (!(await findAuthorizedPortal(queryClient, propertyId, portalId))) throw notFound()
  // Detail includes tokenStatus; the collection row cannot seed this cache entry.
  await queryClient.ensureQueryData(portalQuery(portalId))
}

export const portalShareQueries = (scope: TenantScope, portalId: string) =>
  [responsibleManagersQuery(portalId), membersQuery(scope)] as const

export const portalHistoryQueries = (portalId: string) =>
  [portalPublicationHistoryQuery(portalId)] as const

const portalPageQueries = (scope: TenantScope, propertyId: string, portalId: string) =>
  [
    portalLinksQuery(portalId),
    portalLanguageCoverageQuery(propertyId, portalId),
    portalLinktreeQuery(portalId),
    portalGroupsQuery(propertyId),
    ...portalShareQueries(scope, portalId),
    ...portalHistoryQueries(portalId),
    portalExperienceQuery(propertyId, portalId),
    portalApprovedDestinationsQuery(portalId),
  ] as const

/**
 * The Page tab's editor reads. Each starts on its own and answers on its own:
 * the editor opens on the portal and property alone, and a section waits only
 * for the reads it shows.
 */
export function usePortalPageReads(propertyId: string, portalId: string) {
  const [
    links,
    languages,
    tree,
    groups,
    managers,
    members,
    history,
    experience,
    destinations,
  ] = useQueries({ queries: portalPageQueries(useTenantScope(), propertyId, portalId) })
  return {
    links: links.data?.links,
    languageCoverage: languages.data,
    linktree: tree.data,
    portalGroups: groups.data?.groups,
    responsibleManagers: managers.data,
    responsibleManagerMembers: members.data?.members,
    publicationHistory: history.data,
    portalExperience: experience.data,
    approvedDestinations: destinations.data,
    reads: {
      languageCoverage: languages,
      linktree: tree,
      portalGroups: groups,
      responsibleManagers: managers,
      responsibleManagerMembers: members,
      publicationHistory: history,
      portalExperience: experience,
      approvedDestinations: destinations,
    },
  }
}
