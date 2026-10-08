import {
  createFileRoute,
  notFound,
  Outlet,
  useRouterState,
  type SearchSchemaInput,
} from '@tanstack/react-router'
import { roleUnavailable } from '#/shared/auth/route-notice'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import {
  derivePortalDetailView,
  normalizePortalWorkspaceSearch,
  type PortalDetailTab,
} from '#/components/features/portal/portal-detail/portal-detail-rules'
import type { PortalEditorSection } from '#/components/features/portal/portal-editor/portal-editor-sections'
import { PortalDraftAutosaveProvider } from '#/components/features/portal/portal-editor/portal-draft-autosave-context'
import { PortalLinkIssuanceProvider } from '#/components/features/portal/portal-workspace/portal-link-issuance'
import {
  isWorkspaceReviewRoute,
  portalWorkspaceTitle,
} from '#/components/features/portal/portal-workspace/portal-workspace-route'
import { PortalWorkspaceShell } from '#/components/features/portal/portal-workspace/portal-workspace-shell'
import { PortalWorkspaceTabs } from '#/components/features/portal/portal-workspace/portal-workspace-tabs'
import { documentTitle } from '#/components/layout/page-identity'
import { RouteNotFound } from '#/components/layout/route-page-state'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'
import { membersQuery } from '#/routes/-queries/route-queries'
import { PortalWorkspaceHeaderSlot } from './-portal-workspace-header-slot'
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
  staticData: { page: { title: 'Portal', fullBleed: true } },
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
    if (!can(role, 'portal.read')) throw roleUnavailable('Portal', 'properties')
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
  // The tab is titled after the portal (the static title is the fallback while
  // nothing is cached). Read from the cache the loader filled and every edit
  // updates, so a renamed portal's tab follows on the next navigation.
  head: ({ match, params }) => {
    const name = match.context.queryClient.getQueryData(
      portalQuery(params.portalId).queryKey,
    )?.portal?.name
    return name === undefined
      ? {}
      : { meta: [{ title: documentTitle(portalWorkspaceTitle(name, 'edit')) }] }
  },
  component: PortalWorkspaceLayout,
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
    <RouteNotFound
      entity={{
        heading: 'This portal is no longer available',
        reason: 'It may have been removed, or it may belong to a different property.',
        back: { to: `/properties/${propertyId}/portals`, label: 'Back to portals' },
      }}
    />
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

  const reviewing = isWorkspaceReviewRoute(pathname)
  const view = derivePortalDetailView(tab, has('dashboard.use'))
  const header = (
    <PortalWorkspaceHeaderSlot
      propertyId={propertyId}
      portalId={portalId}
      reviewing={reviewing}
      activeTab={view.tab}
      activeSection={section}
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
