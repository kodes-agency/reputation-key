// Portal list — shows all portals for a property
import { useMemo } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import {
  keepPreviousData,
  queryOptions,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import {
  createPortal,
  getPortalCreationOptions,
  listPortalOverview,
  updatePortal,
} from '#/contexts/portal/server/portals'
import {
  addPortalToGroup,
  createPortalGroup,
  removePortalFromGroup,
  softDeletePortalGroup,
  updatePortalGroup,
} from '#/contexts/portal/server/portal-groups'
import { getPortalResultsOverviewFn } from '#/contexts/reporting/server/portal-results-overview'
import type { PortalResultsTimeRange } from '#/contexts/reporting/application/public-api'
import { PortalListPage } from '#/components/features/portal/portal-list-page'
import {
  indexOverviewResults,
  resultsStateOf,
} from '#/components/features/portal/portal-overview/portal-overview-results'
import { portalOverviewSearchSchema } from '#/components/features/portal/portal-overview/portal-overview-search-schema'
import { useOverviewRange } from '#/components/features/portal/portal-overview/use-overview-range'
import {
  PortalListError,
  PortalListLoading,
} from '#/components/features/portal/portal-route-fallbacks'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { useRouteContext } from '@tanstack/react-router'
import type { PortalNewData } from '#/components/features/portal/portal-new/portal-new-types'
import { portalKeys } from '#/shared/queries/query-keys'
import { membersQuery, propertiesQuery } from '#/routes/-queries/route-queries'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'
import { portalGroupsQuery } from './-portal-detail-data'
import { portalGroupCachePolicy } from '#/components/features/portal/portal-group-cache-policy'

// Read once for every Portal of the Property. A summary of state that changes in
// many places (publishing, codes, managers, groups), so it is refetched on
// arrival; the cached copy still renders first. Short, not zero: the loader has
// just fetched it, and a zero would read the same six sources a second time.
const OVERVIEW_STALE_MS = 5_000

const portalOverviewQuery = (propertyId: string) =>
  queryOptions({
    queryKey: portalKeys.overview(propertyId),
    queryFn: () => listPortalOverview({ data: { propertyId } }),
    staleTime: OVERVIEW_STALE_MS,
  })

// What the New portal dialog reads about the Property. Only fetched once the
// dialog is open; the cached copy is refreshed on each opening, because default
// languages and eligible managers change in other places.
const portalCreationOptionsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: portalKeys.creationOptions(propertyId),
    queryFn: () => getPortalCreationOptions({ data: { propertyId } }),
    staleTime: OVERVIEW_STALE_MS,
  })

// The results beside the list: a separate read, so a slow or refused one never
// holds the list back. Always compared with the period before, as the strip says.
const RESULTS_STALE_MS = 30_000

const portalResultsQuery = (propertyId: string, timeRange: PortalResultsTimeRange) =>
  queryOptions({
    queryKey: portalKeys.resultsOverview(propertyId, timeRange, true),
    queryFn: () =>
      getPortalResultsOverviewFn({ data: { propertyId, timeRange, compare: true } }),
    staleTime: RESULTS_STALE_MS,
  })

export const Route = createFileRoute('/_authenticated/properties/$propertyId/portals/')({
  beforeLoad: async ({ context, params }) => {
    await gateControlledRoute({
      data: {
        capability: 'portal.read',
        featureLabel: 'Portals',
        propertyId: params.propertyId,
      },
    })
    const { role } = context as AuthRouteContext
    if (!can(role, 'portal.read')) throw redirect({ to: '/properties' })
  },
  validateSearch: portalOverviewSearchSchema,
  staleTime: 30_000,
  loader: async ({ params, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(portalOverviewQuery(params.propertyId)),
      context.queryClient.ensureQueryData(portalGroupsQuery(params.propertyId)),
    ])
  },
  pendingComponent: PortalListLoading,
  errorComponent: PortalListError,
  component: PortalListRoute,
})

function PortalListRoute() {
  const { propertyId } = Route.useParams()
  const search = Route.useSearch()
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
  const range = useOverviewRange()
  // `dashboard.read` is a different capability from the `portal.read` that got the
  // reader here: a role without it, or a beta-dark posture, gets the list alone.
  const resultsQuery = useQuery({
    ...portalResultsQuery(propertyId, range.timeRange),
    enabled: range.ready && canDo('dashboard.read'),
    placeholderData: keepPreviousData,
    retry: false,
  })
  const resultsData = resultsQuery.data
  const resultsIndex = useMemo(
    () => (resultsData ? indexOverviewResults(resultsData) : null),
    [resultsData],
  )
  const resultsState = resultsStateOf(
    { allowed: canDo('dashboard.read'), error: resultsQuery.error },
    resultsIndex,
  )
  const { portals } = overviewData
  const { groups } = portalGroupsData
  const { properties } = propsData
  const property = properties?.find((p) => p.id === propertyId)
  const propertyName = property?.name ?? ''

  // The signed-in person is responsible for a new portal by default.
  const { user } = useRouteContext({ from: '/_authenticated' }) as {
    user: { id: string }
  }
  const dialogOpen = search.new === true && canDo('portal.create')
  const creationOptions = useQuery({
    ...portalCreationOptionsQuery(propertyId),
    enabled: dialogOpen,
    retry: false,
  })
  const createMutation = useActionMutation(createPortal, {
    successMessage: 'Portal created',
    invalidateKeys: [portalKeys.all],
    onSuccess: async (output) => {
      // `invalidateKeys` marks the list stale but only REFETCHES active queries,
      // and the plain portals list has no observer here. The workspace's loader
      // resolves the portal against that list, so refetch it first or it would
      // not find the portal that was just created.
      await queryClient.refetchQueries({ queryKey: portalKeys.list(propertyId) })
      // Close the dialog in place first: the entry left behind is the plain
      // list, so Back from the new workspace never reopens an empty dialog.
      await navigate({ search: (prev) => ({ ...prev, new: undefined }), replace: true })
      await navigate({
        to: '/properties/$propertyId/portals/$portalId',
        params: { propertyId, portalId: output.portal.id },
        search: { tab: 'page' },
      })
    },
  })
  const newPortalData: PortalNewData | null = creationOptions.data
    ? {
        propertyId,
        propertyName,
        options: creationOptions.data,
        groups: groups.map((group) => ({ id: group.id, name: group.name })),
        // An archived portal is retired; it is not offered as a starting point.
        sources: portals.filter((portal) => portal.publicationState !== 'archived'),
        members: members.data?.members ?? [],
        creatorId: user.id,
        mutation: createMutation,
      }
    : null

  const archiveMutation = useActionMutation(updatePortal, {
    successMessage: 'Portal archived',
    invalidateKeys: [portalKeys.list(propertyId), portalKeys.all],
  })
  const restoreMutation = useActionMutation(updatePortal, {
    successMessage: 'Portal restored as Disabled',
    invalidateKeys: [portalKeys.list(propertyId), portalKeys.all],
  })
  const createGroupMutation = useActionMutation(createPortalGroup, {
    successMessage: 'Portal group created',
    onSuccess: () => portalGroupCachePolicy.onGroupCreated(queryClient, propertyId),
  })
  const updateGroupMutation = useActionMutation(updatePortalGroup, {
    successMessage: 'Portal group updated',
    onSuccess: () => portalGroupCachePolicy.onGroupUpdated(queryClient, propertyId),
  })
  const deleteGroupMutation = useActionMutation(softDeletePortalGroup, {
    successMessage: 'Portal group archived',
    onSuccess: () => portalGroupCachePolicy.onGroupDeleted(queryClient, propertyId),
  })
  const addPortalToGroupMutation = useActionMutation(addPortalToGroup, {
    successMessage: 'Portal added to group',
    onSuccess: () => portalGroupCachePolicy.onGroupMemberAdded(queryClient, propertyId),
  })
  const removePortalFromGroupMutation = useActionMutation(removePortalFromGroup, {
    successMessage: 'Portal removed from group',
    onSuccess: () => portalGroupCachePolicy.onGroupMemberRemoved(queryClient, propertyId),
  })

  // `groups` is `PortalGroupWithPortals` (a flat PortalGroup plus `portalIds`),
  // which already satisfies `PortalGroupView`, so it goes straight to the page.
  // The previous `item as unknown as {...}` normalization erased that type — the
  // very drift it claimed to guard against — and its `throw` ran during RENDER,
  // so one malformed group replaced the whole portals page via `errorComponent`.
  // `listPortalGroups` always returns `portalIds`; if that ever needs defending,
  // PortalGroupManagement's scoped `state="error"` + `onRetry` is the seam.
  return (
    <PortalListPage
      rows={portals}
      members={members.data?.members.map((member) => ({
        userId: member.userId,
        name: member.name,
      }))}
      propertyId={propertyId}
      propertyName={propertyName}
      results={
        resultsState.status === 'off'
          ? undefined
          : {
              state: resultsState,
              timeRange: range.timeRange,
              onTimeRangeChange: range.setTimeRange,
              onRetry: () => void resultsQuery.refetch(),
              busy: resultsQuery.isPlaceholderData,
            }
      }
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
      archiveMutation={archiveMutation}
      restoreMutation={restoreMutation}
      newPortal={{ data: newPortalData, loadError: creationOptions.error ?? undefined }}
      portalGroups={groups}
      createGroupMutation={createGroupMutation}
      updateGroupMutation={updateGroupMutation}
      deleteGroupMutation={deleteGroupMutation}
      addPortalToGroupMutation={addPortalToGroupMutation}
      removePortalFromGroupMutation={removePortalFromGroupMutation}
    />
  )
}
