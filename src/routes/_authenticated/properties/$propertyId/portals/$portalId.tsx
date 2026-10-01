import {
  createFileRoute,
  Link,
  notFound,
  Outlet,
  redirect,
  useRouterState,
  type SearchSchemaInput,
} from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { usePermissions } from '#/shared/hooks/usePermissions'
import {
  canReviewAndPublish,
  derivePortalDetailView,
  describePendingChanges,
  describePortalStatus,
  normalizePortalWorkspaceSearch,
  type PortalDetailTab,
} from '#/components/features/portal/portal-detail/portal-detail-rules'
import type { PortalEditorSection } from '#/components/features/portal/portal-editor/portal-editor-sections'
import {
  PortalDetailError,
  PortalDetailLoading,
  PortalFallbackFrame,
} from '#/components/features/portal/portal-route-fallbacks'
import { PortalDraftAutosaveProvider } from '#/components/features/portal/portal-editor/portal-draft-autosave-context'
import { PortalDraftSaveStatus } from '#/components/features/portal/portal-editor/portal-draft-save-status'
import { PortalLinkIssuanceProvider } from '#/components/features/portal/portal-workspace/portal-link-issuance'
import { PortalOpenPageButton } from '#/components/features/portal/portal-workspace/portal-open-page-button'
import { deriveOpenPageMode } from '#/components/features/portal/portal-workspace/portal-open-page'
import { PortalWorkspaceHeader } from '#/components/features/portal/portal-workspace/portal-workspace-header'
import { isWorkspaceReviewRoute } from '#/components/features/portal/portal-workspace/portal-workspace-route'
import { PortalWorkspaceShell } from '#/components/features/portal/portal-workspace/portal-workspace-shell'
import { PortalWorkspaceTabs } from '#/components/features/portal/portal-workspace/portal-workspace-tabs'
import { PageHeader } from '#/components/layout/page-header'
import { EmptyState } from '#/components/ui/empty-state'
import { Button } from '#/components/ui/button'
import { AlertCircle } from 'lucide-react'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'
import { membersQuery, propertyQuery } from '#/routes/-queries/route-queries'
import { usePortalOpenPageReveal } from './-portal-detail-actions'
import {
  findAuthorizedPortal,
  portalGroupsQuery,
  portalApprovedDestinationsQuery,
  portalLanguageCoverageQuery,
  portalExperienceQuery,
  portalLinksQuery,
  portalLinktreeQuery,
  portalPublicationHistoryQuery,
  portalQuery,
  responsibleManagersQuery,
} from './-portal-detail-data'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/portals/$portalId',
)({
  // The input is typed so a Link can only name a current tab, and `tab` stays
  // optional (the Page tab is the default). At runtime the value can be
  // anything a bookmark carries; normalization maps the pre-workspace names.
  validateSearch: (
    search: { tab?: PortalDetailTab; section?: PortalEditorSection } & SearchSchemaInput,
  ) => normalizePortalWorkspaceSearch(search),
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
      context.queryClient.ensureQueryData(
        portalLanguageCoverageQuery(params.propertyId, params.portalId),
      ),
      context.queryClient.ensureQueryData(portalLinktreeQuery(params.portalId)),
      context.queryClient.ensureQueryData(portalGroupsQuery(params.propertyId)),
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
  component: PortalWorkspaceLayout,
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
    <PortalFallbackFrame>
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
    </PortalFallbackFrame>
  )
}

/**
 * The workspace layout: header, tab strip and one scrolling body, with the
 * editor (`index`) or the review page (`review`) rendered inside it. Every read
 * the header needs was seeded by the loader, so these resolve from cache.
 */
function PortalWorkspaceLayout() {
  const { propertyId, portalId } = Route.useParams()
  const { tab, section } = Route.useSearch()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { has } = useCapabilities()
  const { can: canDo } = usePermissions()
  const { data: portalData } = useSuspenseQuery(portalQuery(portalId))
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: history } = useSuspenseQuery(portalPublicationHistoryQuery(portalId))
  const revealForOpenPage = usePortalOpenPageReveal()
  const { portal, tokenStatus } = portalData
  if (!portal) throw notFound()

  const reviewing = isWorkspaceReviewRoute(pathname)
  const view = derivePortalDetailView(tab, has('dashboard.use'))
  const header = (
    <PortalWorkspaceHeader
      mode={reviewing ? 'review' : 'edit'}
      propertyId={propertyId}
      portalId={portalId}
      portalName={portal.name}
      propertyName={propData.property.name}
      statusLine={describePortalStatus(
        portal.publicationState,
        history.current?.version ?? null,
      )}
      pendingNote={describePendingChanges(history)}
      canReview={canReviewAndPublish(
        { canUpdate: canDo('portal.update'), portalWriteEnabled: has('portal.write') },
        portal.publicationState,
      )}
      activeTab={view.tab}
      activeSection={section}
      saveStatus={<PortalDraftSaveStatus />}
      openPage={
        <PortalOpenPageButton
          propertyId={propertyId}
          portalId={portalId}
          mode={deriveOpenPageMode({
            canReveal: canDo('portal.update') && has('portal.write'),
            publicationState: portal.publicationState,
            tokenStatus,
          })}
          revealMutation={revealForOpenPage}
        />
      }
    />
  )
  const tabs = reviewing ? undefined : (
    <PortalWorkspaceTabs
      propertyId={propertyId}
      portalId={portalId}
      activeTab={view.tab}
      hiddenTabs={view.hiddenTabs}
    />
  )

  return (
    // Keyed so a once-shown public link can never follow the manager into a
    // different portal when the router reuses this layout for a new `portalId`.
    // The autosave coordinator is keyed the same way, so one portal's unsaved
    // edits can never be written into another.
    <PortalLinkIssuanceProvider key={portalId}>
      <PortalDraftAutosaveProvider key={portalId}>
        <PortalWorkspaceShell header={header} tabs={tabs}>
          <Outlet />
        </PortalWorkspaceShell>
      </PortalDraftAutosaveProvider>
    </PortalLinkIssuanceProvider>
  )
}
