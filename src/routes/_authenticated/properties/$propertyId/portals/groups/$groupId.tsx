// fallow-ignore-file code-duplication
// r4 s38: parallel dialog forms, server-function shells and ledger rows share intentional boilerplate.
// A portal group's page: its results, its portals, the goal it shares and its
// history (board 13). A group is a collection of Portals inside one Property for
// shared results and goals; guests never see it.
import { useState } from 'react'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { roleUnavailable } from '#/shared/auth/route-notice'
import {
  queryOptions,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { isBetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
import { updatePortal } from '#/contexts/portal/server/portals'
import {
  listPortalGroupHistory,
  movePortalToGroup,
  removePortalFromGroup,
  softDeletePortalGroup,
  updatePortalGroup,
} from '#/contexts/portal/server/portal-groups'
import { getGoalProgress } from '#/contexts/reporting/server/goal-programs'
import { PortalGroupPage } from '#/components/features/portal/portal-group/portal-group-page'
import { readStateOf } from '#/components/features/portal/portal-group/portal-group-read-state'
import { portalGroupCachePolicy } from '#/components/features/portal/portal-group-cache-policy'
import { RouteNotFound } from '#/components/layout/route-page-state'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'
import { goalKeys, portalKeys } from '#/shared/queries/query-keys'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { membersQuery, propertyQuery } from '#/routes/-queries/route-queries'
import { portalGroupsQuery } from '../-portal-detail-data'
import { portalOverviewQuery } from '../-portal-overview-data'
import { usePortalResultsControls } from '../-portal-results-controls'
import { isRetrying } from '#/components/hooks/is-retrying'

const SIDE_READ_STALE_MS = 30_000

const groupHistoryQuery = (propertyId: string, groupId: string) =>
  queryOptions({
    queryKey: portalKeys.groupHistory(propertyId, groupId),
    queryFn: () => listPortalGroupHistory({ data: { portalGroupId: groupId } }),
    staleTime: SIDE_READ_STALE_MS,
  })

// The live month to date of the goals that target this group: never a result.
const groupGoalQuery = (propertyId: string, groupId: string) =>
  queryOptions({
    queryKey: goalKeys.progress(propertyId, `portal_group:${groupId}`),
    queryFn: () =>
      getGoalProgress({
        data: { propertyId, subject: { kind: 'portal_group', portalGroupId: groupId } },
      }),
    staleTime: SIDE_READ_STALE_MS,
  })

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/portals/groups/$groupId',
)({
  staticData: { page: { title: 'Portal group', tier: 'dashboard', under: 'portals' } },
  beforeLoad: async ({ context, params }) => {
    await gateControlledRoute({
      data: {
        capability: 'portal.read',
        featureLabel: 'Portals',
        propertyId: params.propertyId,
      },
    })
    const { role } = context as AuthRouteContext
    if (!can(role, 'portal.read')) throw roleUnavailable('Portal group', 'properties')
  },
  staleTime: 30_000,
  loader: async ({ params, context }) => {
    const [groups] = await Promise.all([
      context.queryClient.ensureQueryData(portalGroupsQuery(params.propertyId)),
      context.queryClient.ensureQueryData(portalOverviewQuery(params.propertyId)),
      context.queryClient.ensureQueryData(propertyQuery(params.propertyId)),
    ])
    // The list holds only this Property's groups the reader may see, so a group
    // of another Property or Organization is simply absent: the same page as an
    // archived one, which says nothing about why.
    if (!groups.groups.some((group) => group.id === params.groupId)) throw notFound()
  },
  notFoundComponent: GroupNoLongerAvailable,
  component: PortalGroupRoute,
})

function GroupNoLongerAvailable() {
  const { propertyId } = Route.useParams()
  return (
    <RouteNotFound
      entity={{
        heading: 'This group is no longer available',
        reason: 'It may have been archived, or it may belong to a different property.',
        back: { to: `/properties/${propertyId}/portals`, label: 'Back to portals' },
      }}
    />
  )
}

// fallow-ignore-next-line complexity
function PortalGroupRoute() {
  const { propertyId, groupId } = Route.useParams()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const { can: canDo, role } = usePermissions()
  const { has } = useCapabilities()
  const [now] = useState(() => new Date())
  const { data: overview } = useSuspenseQuery(portalOverviewQuery(propertyId))
  const { data: groupsData } = useSuspenseQuery(portalGroupsQuery(propertyId))
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const members = useQuery({
    ...membersQuery,
    enabled: canDo('member.list'),
    retry: false,
  })
  const results = usePortalResultsControls(propertyId)

  // `goal.read` alone admits roles the Goals page refuses, so the card is asked
  // for only where the Goals page itself would open.
  const goals = useQuery({
    ...groupGoalQuery(propertyId, groupId),
    enabled: canDo('goal.read') && has('goal.use') && isBetaInteractiveRole(role),
    retry: false,
  })
  const history = useQuery({ ...groupHistoryQuery(propertyId, groupId), retry: false })

  const archiveMutation = useActionMutation(updatePortal, {
    successMessage: 'Portal archived',
    invalidateKeys: [portalKeys.list(propertyId), portalKeys.all],
  })
  const restoreMutation = useActionMutation(updatePortal, {
    successMessage: 'Portal restored as disabled',
    invalidateKeys: [portalKeys.list(propertyId), portalKeys.all],
  })
  const disableMutation = useActionMutation(updatePortal, {
    successMessage: 'Public page disabled',
    invalidateKeys: [portalKeys.list(propertyId), portalKeys.all],
  })
  const renameMutation = useActionMutation(updatePortalGroup, {
    successMessage: 'Group renamed',
    onSuccess: () => portalGroupCachePolicy.onGroupUpdated(queryClient, propertyId),
  })
  const movePortalMutation = useActionMutation(movePortalToGroup, {
    onSuccess: () => portalGroupCachePolicy.onGroupMemberAdded(queryClient, propertyId),
  })
  const removePortalMutation = useActionMutation(removePortalFromGroup, {
    successMessage: 'Portal removed from group',
    onSuccess: () => portalGroupCachePolicy.onGroupMemberRemoved(queryClient, propertyId),
  })
  // Leave the page first: once the group is gone from the list, its own page
  // would render as unavailable for the moment before the navigation lands.
  const archiveGroupMutation = useActionMutation(softDeletePortalGroup, {
    successMessage: 'Group archived',
    onSuccess: async () => {
      await navigate({ to: '/properties/$propertyId/portals', params: { propertyId } })
      await portalGroupCachePolicy.onGroupDeleted(queryClient, propertyId)
    },
  })

  const group = groupsData.groups.find((candidate) => candidate.id === groupId)
  if (!group) return <GroupNoLongerAvailable />
  const rows = overview.portals
  const memberNames = new Map(
    (members.data?.members ?? []).map((member) => [member.userId, member.name]),
  )
  const portalNames = new Map(rows.map((row) => [row.portalId as string, row.name]))
  const groupNames = new Map(
    groupsData.groups.map((other) => [other.id as string, other.name]),
  )

  return (
    <PortalGroupPage
      propertyId={propertyId}
      propertyName={propData.property.name}
      timezone={propData.property.timezone}
      group={{ id: group.id, name: group.name }}
      rows={rows}
      members={(members.data?.members ?? []).map((member) => ({
        userId: member.userId,
        name: member.name,
      }))}
      results={results}
      goals={readStateOf({
        allowed: canDo('goal.read') && has('goal.use') && isBetaInteractiveRole(role),
        error: goals.error,
        data: goals.data?.goals,
        retrying: isRetrying(goals),
      })}
      history={readStateOf({
        allowed: true,
        error: history.error,
        data: history.data?.entries,
        retrying: isRetrying(history),
      })}
      names={{
        actor: (userId) => memberNames.get(userId) ?? null,
        portal: (portalId) => portalNames.get(portalId) ?? null,
        group: (otherId) => groupNames.get(otherId) ?? null,
      }}
      personName={(userId) => memberNames.get(userId) ?? null}
      now={now}
      onRetryGoals={() => void goals.refetch()}
      onRetryHistory={() => void history.refetch()}
      archiveMutation={archiveMutation}
      restoreMutation={restoreMutation}
      disableMutation={disableMutation}
      renameMutation={renameMutation}
      archiveGroupMutation={archiveGroupMutation}
      movePortalMutation={movePortalMutation}
      removePortalMutation={removePortalMutation}
    />
  )
}
