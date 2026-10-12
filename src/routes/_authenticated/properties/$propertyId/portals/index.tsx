// fallow-ignore-file code-duplication
// r4 s38: parallel dialog forms, server-function shells and ledger rows share intentional boilerplate.
// Portal list — shows all portals for a property
import { createFileRoute } from '@tanstack/react-router'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { updatePortal } from '#/contexts/portal/server/portals'
import {
  createPortalGroup,
  softDeletePortalGroup,
  updatePortalGroup,
} from '#/contexts/portal/server/portal-groups'
import { PortalListPage } from '#/components/features/portal/portal-list-page'
import {
  portalOverviewSearchSchema,
  type PortalOverviewSearch,
} from '#/components/features/portal/portal-overview/portal-overview-search-schema'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { portalKeys } from '#/shared/queries/query-keys'
import { membersQuery, propertiesQuery } from '#/routes/-queries/route-queries'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'
import { portalGroupsQuery } from './-portal-detail-data'
import { portalOverviewQuery } from './-portal-overview-data'
import { useNewPortal } from './-use-new-portal'
import { usePortalResultsControls } from './-portal-results-controls'
import { usePortalInboxWaiting } from './-portal-inbox-waiting'
import { portalGroupCachePolicy } from '#/components/features/portal/portal-group-cache-policy'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/portals/')({
  staticData: { page: { title: 'Portals', tier: 'dashboard', under: 'property' } },
  beforeLoad: async ({ context, params }) => {
    await gateControlledRoute({
      data: {
        capability: 'portal.read',
        featureLabel: 'Portals',
        propertyId: params.propertyId,
      },
    })
    const { role } = context as AuthRouteContext
    if (!can(role, 'portal.read')) throw roleUnavailable('Portals', 'properties')
  },
  validateSearch: (search) => portalOverviewSearchSchema.parse(search),
  staleTime: 30_000,
  loader: async ({ params, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(portalOverviewQuery(params.propertyId)),
      context.queryClient.ensureQueryData(portalGroupsQuery(params.propertyId)),
    ])
  },
  component: PortalListRoute,
})

function PortalListRoute() {
  const { propertyId } = Route.useParams()
  const search: PortalOverviewSearch = Route.useSearch()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const { can: canDo } = usePermissions()
  const { data: overviewData } = useSuspenseQuery(portalOverviewQuery(propertyId))
  const { data: portalGroupsData } = useSuspenseQuery(portalGroupsQuery(propertyId))
  const { data: propsData } = useSuspenseQuery(propertiesQuery)
  // Names for the responsible managers' discs. An enrichment, not the page: a
  // role that cannot list members, or an outage, leaves the discs without initials.
  const members = useQuery({
    ...membersQuery,
    enabled: canDo('member.list'),
    retry: false,
  })
  const results = usePortalResultsControls(propertyId)
  const inboxWaiting = usePortalInboxWaiting(propertyId)
  const { portals } = overviewData
  const { groups } = portalGroupsData
  const { properties } = propsData
  const property = properties?.find((p) => p.id === propertyId)
  const propertyName = property?.name ?? ''

  const newPortal = useNewPortal({
    propertyId,
    propertyName,
    open: search.new === true && canDo('portal.create'),
    groups,
    portals,
    members: members.data?.members,
  })

  const archiveMutation = useActionMutation(updatePortal, {
    successMessage: 'Portal archived',
    invalidateKeys: [portalKeys.list(propertyId), portalKeys.all],
  })
  const restoreMutation = useActionMutation(updatePortal, {
    successMessage: 'Portal restored as Disabled',
    invalidateKeys: [portalKeys.list(propertyId), portalKeys.all],
  })
  const disableMutation = useActionMutation(updatePortal, {
    successMessage: 'Public page disabled',
    invalidateKeys: [portalKeys.list(propertyId), portalKeys.all],
  })
  // Every dialog here (the forms and the archive confirmations) stays open and
  // shows a refusal itself, so none of these mutations toasts one as well.
  const createMutation = useActionMutation(createPortalGroup, {
    successMessage: 'Group created',
    onSuccess: () => portalGroupCachePolicy.onGroupCreated(queryClient, propertyId),
  })
  const renameMutation = useActionMutation(updatePortalGroup, {
    successMessage: 'Group renamed',
    onSuccess: () => portalGroupCachePolicy.onGroupUpdated(queryClient, propertyId),
  })
  const archiveGroupMutation = useActionMutation(softDeletePortalGroup, {
    successMessage: 'Group archived',
    onSuccess: () => portalGroupCachePolicy.onGroupDeleted(queryClient, propertyId),
  })

  // `groups` is `PortalGroupWithPortals` (a flat PortalGroup plus `portalIds`):
  // the page needs only each group's id and name, to reach one that holds no Portal.
  return (
    <PortalListPage
      rows={portals}
      members={members.data?.members.map((member) => ({
        userId: member.userId,
        name: member.name,
      }))}
      propertyId={propertyId}
      propertyName={propertyName}
      results={results}
      inboxWaiting={inboxWaiting}
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
      archiveMutation={archiveMutation}
      restoreMutation={restoreMutation}
      disableMutation={disableMutation}
      groups={groups.map((group) => ({ id: group.id, name: group.name }))}
      createMutation={createMutation}
      renameMutation={renameMutation}
      archiveGroupMutation={archiveGroupMutation}
      newPortal={newPortal}
    />
  )
}
