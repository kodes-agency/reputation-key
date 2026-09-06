import { createFileRoute, Link, notFound, redirect } from '@tanstack/react-router'
import { z } from 'zod/v4'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { getPortalAnalyticsFn } from '#/contexts/dashboard/server/portal-analytics'
import {
  PORTAL_DETAIL_TABS,
  PortalDetailPage,
  type PortalDetailTab,
} from '#/components/features/portal'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { ErrorState, LoadingState } from '#/components/layout/page-states'
import { EmptyState } from '#/components/ui/empty-state'
import { Button } from '#/components/ui/button'
import { AlertCircle } from 'lucide-react'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'
import { membersQuery } from '#/routes/-queries/route-queries'
import { usePortalDetailActions } from './-portal-detail-actions'
import {
  findAuthorizedPortal,
  portalApprovedDestinationsQuery,
  portalExperienceQuery,
  portalLinksQuery,
  portalPublicationHistoryQuery,
  portalQuery,
  responsibleManagersQuery,
  usePortalDetailData,
} from './-portal-detail-data'

const portalDetailSearchSchema = z.object({
  tab: z.enum(PORTAL_DETAIL_TABS).catch('settings').default('settings'),
})

const normalizePortalDetailSearch = (search: unknown): { tab: PortalDetailTab } =>
  portalDetailSearchSchema.parse(search)

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/portals/$portalId',
)({
  validateSearch: normalizePortalDetailSearch,
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
  staleTime: 30_000,
  loader: async ({ params, context }) => {
    const portal = await findAuthorizedPortal(
      context.queryClient,
      params.propertyId,
      params.portalId,
    )
    // `notFound()`, not `/unavailable`: that page states the whole Portals
    // feature is switched off, which is a lie while the sidebar still links to a
    // working list. `notFoundComponent` renders an in-route "no longer
    // available" state instead. `/unavailable` stays for the capability-denied
    // and cross-tenant PROPERTY cases, which `gateControlledRoute` decides in
    // beforeLoad. A portal id belonging to another property or organization is
    // simply absent from this collection, so it lands here — identical to a
    // removed portal, which is the point.
    if (!portal) throw notFound()
    await Promise.all([
      // The detail entry is FETCHED, not seeded from the list row: `getPortal`
      // also returns `tokenStatus` (C2), which no list row carries, so a
      // hand-built `{ portal }` seed would leave the Share tab reading
      // `tokenStatus` as undefined instead of triggering a fetch.
      context.queryClient.ensureQueryData(portalQuery(params.portalId)),
      context.queryClient.ensureQueryData(portalLinksQuery(params.portalId)),
      context.queryClient.ensureQueryData(responsibleManagersQuery(params.portalId)),
      context.queryClient.ensureQueryData(membersQuery),
      context.queryClient.ensureQueryData(portalPublicationHistoryQuery(params.portalId)),
      context.queryClient.ensureQueryData(
        portalExperienceQuery(params.propertyId, params.portalId),
      ),
      context.queryClient.ensureQueryData(
        portalApprovedDestinationsQuery(params.portalId),
      ),
    ])
  },
  component: PortalDetailRoute,
  pendingComponent: PortalDetailLoading,
  errorComponent: PortalDetailError,
  notFoundComponent: PortalNoLongerAvailable,
})

/**
 * Rendered when the portal is absent from this property's authorized
 * collection. Deliberately says nothing about WHY — deleted, moved, or owned by
 * another property/organization all land here with identical copy, so the URL
 * cannot be used to probe for portals the caller may not see.
 */
function PortalNoLongerAvailable() {
  const { propertyId } = Route.useParams()
  return (
    <PageShell>
      <PageHeader
        title="Portal unavailable"
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: 'Portals', to: `/properties/${propertyId}/portals` },
          { label: 'Unavailable' },
        ]}
      />
      <EmptyState icon={AlertCircle} title="This portal is no longer available">
        <p className="text-sm text-muted-foreground">
          It may have been removed, or it may belong to a different property.
        </p>
        <Button asChild variant="outline">
          <Link to="/properties/$propertyId/portals" params={{ propertyId }}>
            Back to Portals
          </Link>
        </Button>
      </EmptyState>
    </PageShell>
  )
}

function PortalDetailLoading() {
  return (
    <PageShell>
      <LoadingState label="Loading portal details" />
    </PageShell>
  )
}

function PortalDetailError({ error }: { error: Error }) {
  return (
    <PageShell>
      <PageHeader title="Portal" description="Manage this property’s public page." />
      <ErrorState message={error.message || 'This portal could not be loaded.'} />
    </PageShell>
  )
}

function PortalDetailRoute() {
  const { propertyId, portalId } = Route.useParams()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  const data = usePortalDetailData(propertyId, portalId)
  const { portal, tokenStatus } = data.portalData
  const { categories, links } = data.linksData
  const { property } = data.propData
  if (!portal) throw notFound()
  const ctx = Route.useRouteContext()
  const actions = usePortalDetailActions(propertyId, portalId)

  return (
    <PageShell>
      <PageHeader
        title={portal.name}
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: property.name, to: `/properties/${propertyId}` },
          { label: 'Portals', to: `/properties/${propertyId}/portals` },
          { label: portal.name },
        ]}
      />
      <PortalDetailPage
        key={portal.id}
        portal={portal}
        tokenStatus={tokenStatus}
        propertyId={propertyId}
        googleReviewDestination={{
          state: property.googleReviewDestination?.state ?? 'unavailable',
          retrievedAt: property.googleReviewDestination?.retrievedAt ?? null,
        }}
        publicationHistory={data.publicationHistory}
        loadMorePublicationHistory={data.loadMorePublicationHistory}
        categories={categories}
        links={links}
        activeTab={tab}
        onTabChange={(nextTab) => {
          // No `replace: true`: replacing the entry made browser Back leave the
          // portal entirely instead of returning to the previously viewed tab.
          // Deep links via ?tab= are unaffected.
          void navigate({ search: { tab: nextTab } })
        }}
        updateMutation={actions.update}
        organizationName={ctx.activeOrganization?.name ?? 'Your Organization'}
        issueTokenMutation={actions.issueToken}
        rotateTokenMutation={actions.rotateToken}
        revokeTokenMutation={actions.revokeToken}
        getPortalAnalytics={getPortalAnalyticsFn}
        completeReviewMutation={actions.completeReview}
        responsibleManagers={data.responsibleManagers}
        responsibleManagerMembers={data.membersData.members}
        updateResponsibleManagersMutation={actions.updateResponsibleManagers}
        portalExperience={data.portalExperience}
        approvedDestinations={data.approvedDestinations}
        portalExperienceActions={actions.experience}
      />
    </PageShell>
  )
}
