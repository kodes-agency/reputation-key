import {
  createFileRoute,
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
  portalWorkspaceTitle,
  type PortalDetailTab,
} from '#/components/features/portal/portal-detail/portal-detail-rules'
import type { PortalEditorSection } from '#/components/features/portal/portal-editor/portal-editor-sections'
import { PortalDraftAutosaveProvider } from '#/components/features/portal/portal-editor/portal-draft-autosave-context'
import { PortalLinkIssuanceProvider } from '#/components/features/portal/portal-workspace/portal-link-issuance'
import { isWorkspaceReviewRoute } from '#/components/features/portal/portal-workspace/portal-workspace-route'
import { PortalWorkspaceShell } from '#/components/features/portal/portal-workspace/portal-workspace-shell'
import { PortalWorkspaceTabs } from '#/components/features/portal/portal-workspace/portal-workspace-tabs'
import { documentTitle } from '#/components/layout/page-identity'
import { RouteNotFound } from '#/components/layout/route-page-state'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'
import { PortalWorkspaceHeaderSlot } from './-portal-workspace-header-slot'
import { PortalWorkspaceNoticeSlot } from './-portal-workspace-notice-slot'
import { loadPortalWorkspace, portalQuery } from './-portal-detail-data'

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
  loader: ({ params, context }) =>
    loadPortalWorkspace(context.queryClient, params.propertyId, params.portalId),
  // The tab is titled after the portal (the static title is the fallback while
  // nothing is cached). Read from the cache the loader filled and every edit
  // updates, so a renamed portal's tab follows on the next navigation.
  head: ({ match, params }) => {
    const name = match.context.queryClient.getQueryData(
      portalQuery(params.portalId).queryKey,
    )?.portal?.name
    return name === undefined
      ? {}
      : { meta: [{ title: documentTitle(portalWorkspaceTitle(name)) }] }
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
        <PortalWorkspaceShell
          header={header}
          tabs={tabs}
          notice={
            reviewing ? undefined : (
              <PortalWorkspaceNoticeSlot propertyId={propertyId} portalId={portalId} />
            )
          }
        >
          <Outlet />
        </PortalWorkspaceShell>
      </PortalDraftAutosaveProvider>
    </PortalLinkIssuanceProvider>
  )
}
