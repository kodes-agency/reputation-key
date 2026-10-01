// All properties — every Portal the reader may see, under the Property it
// belongs to (board 10). The Portals page of one Property stays under
// /properties/$propertyId/portals; this is the same overview over the whole
// Organization, reached from the Portals entry when no Property is chosen.
import { useMemo } from 'react'
import { createFileRoute, getRouteApi, redirect } from '@tanstack/react-router'
import {
  keepPreviousData,
  queryOptions,
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { listPortalOverview, updatePortal } from '#/contexts/portal/server/portals'
import { getPortalResultsOverviewFn } from '#/contexts/reporting/server/portal-results-overview'
import type { PortalResultsTimeRange } from '#/contexts/reporting/application/public-api'
import { PortalAllPropertiesPage } from '#/components/features/portal/portal-all-properties-page'
import { allPropertiesSearchSchema } from '#/components/features/portal/portal-overview/portal-overview-search-schema'
import {
  indexOverviewResults,
  resultsStateOf,
} from '#/components/features/portal/portal-overview/portal-overview-results'
import { useOverviewRange } from '#/components/features/portal/portal-overview/use-overview-range'
import {
  PortalAllPropertiesError,
  PortalListLoading,
} from '#/components/features/portal/portal-route-fallbacks'
import { partitionWorkspaceProperties } from '#/components/features/property/property-workspace'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { portalKeys } from '#/shared/queries/query-keys'
import { membersQuery, propertiesQuery } from '#/routes/-queries/route-queries'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'

const authRoute = getRouteApi('/_authenticated')

// Read once for every Portal the reader may see. The same short staleness as a
// Property's own overview: a summary of state that changes in many places, so it
// is refetched on arrival while the loader's fetch is not repeated at once.
const OVERVIEW_STALE_MS = 5_000

const organizationOverviewQuery = queryOptions({
  queryKey: portalKeys.organizationOverview(),
  queryFn: () => listPortalOverview({ data: {} }),
  staleTime: OVERVIEW_STALE_MS,
})

// The results beside the list: a separate read, so a slow or refused one never
// holds the list back. Always compared with the period before, as the strip says.
const RESULTS_STALE_MS = 30_000

const organizationResultsQuery = (timeRange: PortalResultsTimeRange) =>
  queryOptions({
    queryKey: portalKeys.organizationResultsOverview(timeRange, true),
    queryFn: () => getPortalResultsOverviewFn({ data: { timeRange, compare: true } }),
    staleTime: RESULTS_STALE_MS,
  })

export const Route = createFileRoute('/_authenticated/portals/')({
  beforeLoad: async ({ context }) => {
    // Organization-wide: no Property is in scope, so the gate asks about the
    // Organization; the reads narrow to each Property the reader may use.
    await gateControlledRoute({
      data: { capability: 'portal.read', featureLabel: 'Portals' },
    })
    const { role } = context as AuthRouteContext
    if (!can(role, 'portal.read')) throw redirect({ to: '/properties' })
  },
  validateSearch: (search) => allPropertiesSearchSchema.parse(search),
  staleTime: 30_000,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(organizationOverviewQuery)
  },
  pendingComponent: PortalListLoading,
  errorComponent: PortalAllPropertiesError,
  component: AllPropertiesRoute,
})

function AllPropertiesRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const ctx = authRoute.useRouteContext() as AuthRouteContext
  const { can: canDo, scopeForPermission } = usePermissions()
  const { data: overviewData } = useSuspenseQuery(organizationOverviewQuery)
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
    ...organizationResultsQuery(range.timeRange),
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
  const { properties } = propsData
  const newPortalProperties = useMemo(
    () => partitionWorkspaceProperties(properties).workspace,
    [properties],
  )

  const archiveMutation = useActionMutation(updatePortal, {
    successMessage: 'Portal archived',
    invalidateKeys: [portalKeys.all],
  })
  const restoreMutation = useActionMutation(updatePortal, {
    successMessage: 'Portal restored as Disabled',
    invalidateKeys: [portalKeys.all],
  })

  return (
    <PortalAllPropertiesPage
      rows={overviewData.portals}
      properties={properties}
      newPortalProperties={newPortalProperties}
      members={members.data?.members.map((member) => ({
        userId: member.userId,
        name: member.name,
      }))}
      organizationName={ctx.activeOrganization?.name}
      organizationWide={scopeForPermission('property.read') === 'organization'}
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
    />
  )
}
