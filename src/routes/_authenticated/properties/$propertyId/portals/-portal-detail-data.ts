import { queryOptions, useSuspenseQuery, type QueryClient } from '@tanstack/react-query'
import {
  getPropertyPortalExperience,
  getPortal,
  getPortalPublicationHistory,
  listPortals,
  listPortalApprovedDestinations,
} from '#/contexts/portal/server/portals'
import { listPortalLinks } from '#/contexts/portal/server/portal-links'
import { listPortalResponsibleManagers } from '#/contexts/portal/server/portal-responsible-managers'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
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
 * while the user is on `../portals/new`, so the cache still held the
 * pre-creation list: a portal created a second earlier was reported unavailable.
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
 * Every read the portal detail screen needs. The route loader has already
 * seeded all of these, so each `useSuspenseQuery` resolves from cache on the
 * first render.
 */
export function usePortalDetailData(propertyId: string, portalId: string) {
  const { data: portalData } = useSuspenseQuery(portalQuery(portalId))
  const { data: linksData } = useSuspenseQuery(portalLinksQuery(portalId))
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
  const loadMorePublicationHistory = useActionMutation(getPortalPublicationHistory)

  return {
    portalData,
    linksData,
    propData,
    responsibleManagers,
    membersData,
    publicationHistory,
    portalExperience,
    approvedDestinations,
    loadMorePublicationHistory,
  }
}
