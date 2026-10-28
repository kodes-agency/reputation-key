import { notFound } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery, type QueryClient } from '@tanstack/react-query'
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
import { membersQuery, propertyQuery } from '#/routes/-queries/route-queries'
import type { Portal, PortalTokenStatus } from '#/contexts/portal/application/public-api'

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

export const portalLinksQuery = (portalId: string) =>
  queryOptions({
    queryKey: portalKeys.links(portalId),
    queryFn: () => listPortalLinks({ data: { portalId } }),
    staleTime: 30_000,
  })

export const portalLanguageCoverageQuery = (propertyId: string, portalId: string) =>
  queryOptions({
    queryKey: portalKeys.languageCoverage(propertyId, portalId),
    queryFn: () => getPortalLanguageCoverage({ data: { portalId } }),
    staleTime: 30_000,
  })

export const portalLinktreeQuery = (portalId: string) =>
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

export const portalExperienceQuery = (propertyId: string, portalId: string) =>
  queryOptions({
    queryKey: portalKeys.experience(propertyId, portalId),
    queryFn: () => getPropertyPortalExperience({ data: { propertyId, portalId } }),
    staleTime: 30_000,
  })

export const portalApprovedDestinationsQuery = (portalId: string) =>
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
export const findAuthorizedPortal = async (
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

/**
 * The workspace loader: the portal is looked up in the property's authorized
 * collection AND the ten reads of the screen start at the same moment.
 *
 * They used to run in sequence (the list, then the ten), which put a whole
 * round trip in front of every read (a chain six deep on a slow network, the
 * preview at 4.4 s). The reads do not depend on the lookup, so they start
 * together; what the lookup decides is what the person is told.
 *
 * - The portal is not in this property's collection: `notFound()`, whatever the
 *   other reads did. A portal of another property or organization fails some of
 *   them for reasons of its own, and those must not tell it apart from one that
 *   was removed (a direct URL never reveals that a portal exists elsewhere).
 * - The portal is there and a read failed: that failure, the first, so the route
 *   shows its error and Try again as before. Every read is waited for, so none
 *   is left running unobserved.
 *
 * `notFound()`, not `/unavailable`: that page states the whole Portals feature
 * is switched off, which is a lie while the sidebar still links to a working
 * list. `notFoundComponent` renders an in-route "no longer available" state
 * instead. `/unavailable` stays for the capability-denied and cross-tenant
 * PROPERTY cases, which `gateControlledRoute` decides in `beforeLoad`.
 */
export async function loadPortalWorkspace(
  queryClient: QueryClient,
  propertyId: string,
  portalId: string,
): Promise<void> {
  const [lookup, ...reads] = await Promise.allSettled([
    findAuthorizedPortal(queryClient, propertyId, portalId),
    // The detail entry is FETCHED, not seeded from the list row: `getPortal`
    // also returns `tokenStatus` (C2), which no list row carries, so a
    // hand-built `{ portal }` seed would leave the Share tab reading
    // `tokenStatus` as undefined instead of triggering a fetch.
    queryClient.ensureQueryData(portalQuery(portalId)),
    queryClient.ensureQueryData(portalLinksQuery(portalId)),
    queryClient.ensureQueryData(portalLanguageCoverageQuery(propertyId, portalId)),
    queryClient.ensureQueryData(portalLinktreeQuery(portalId)),
    queryClient.ensureQueryData(portalGroupsQuery(propertyId)),
    queryClient.ensureQueryData(responsibleManagersQuery(portalId)),
    queryClient.ensureQueryData(membersQuery),
    queryClient.ensureQueryData(portalPublicationHistoryQuery(portalId)),
    queryClient.ensureQueryData(portalExperienceQuery(propertyId, portalId)),
    queryClient.ensureQueryData(portalApprovedDestinationsQuery(portalId)),
  ])
  if (lookup.status === 'rejected') throw lookup.reason
  if (!lookup.value) throw notFound()
  for (const read of reads) {
    if (read.status === 'rejected') throw read.reason
  }
}

/**
 * Every read the portal detail screen needs. The route loader has already
 * seeded all of these, so each `useSuspenseQuery` resolves from cache on the
 * first render.
 */
export function usePortalDetailData(propertyId: string, portalId: string) {
  const { data: portalData } = useSuspenseQuery(portalQuery(portalId))
  const { data: linksData } = useSuspenseQuery(portalLinksQuery(portalId))
  const { data: languageCoverage } = useSuspenseQuery(
    portalLanguageCoverageQuery(propertyId, portalId),
  )
  const { data: linktree } = useSuspenseQuery(portalLinktreeQuery(portalId))
  const { data: groupsData } = useSuspenseQuery(portalGroupsQuery(propertyId))
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: responsibleManagers } = useSuspenseQuery(
    responsibleManagersQuery(portalId),
  )
  const { data: membersData } = useSuspenseQuery(membersQuery)
  const { data: publicationHistory } = useSuspenseQuery(
    portalPublicationHistoryQuery(portalId),
  )
  const { data: portalExperience } = useSuspenseQuery(
    portalExperienceQuery(propertyId, portalId),
  )
  const { data: approvedDestinations } = useSuspenseQuery(
    portalApprovedDestinationsQuery(portalId),
  )
  return {
    portalData,
    linksData,
    languageCoverage,
    linktree,
    groupsData,
    propData,
    responsibleManagers,
    membersData,
    publicationHistory,
    portalExperience,
    approvedDestinations,
  }
}
