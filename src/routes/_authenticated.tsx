import { StaffAccountFunctionsContext } from '#/components/features/staff/accounts/staff-account-functions'
import { STAFF_ACCOUNT_FUNCTIONS } from './_authenticated/-staff-account-functions'
// Authenticated layout route — protects all nested routes and renders the app shell.
// Per better-auth TanStack Start docs: use createServerFn (getSession)
// in beforeLoad — not authClient.getSession(), which can't forward cookies during SSR.
import { useEffect } from 'react'
import { createFileRoute, Outlet, redirect, isRedirect } from '@tanstack/react-router'
import { getProductUpdatesClient } from './_authenticated/-product-updates-client'
import { getSession } from '#/shared/auth/auth.functions'
import { getActiveOrganization } from '#/contexts/identity/server/organizations'
import { getLastVisitCountFn } from '#/contexts/inbox/server/inbox'
import { notificationFns } from '#/routes/-notification-fns'
import { readViewportHint } from '#/routes/-viewport-hint'
import { staleTab, watchPerson } from '#/shared/stale-tab/stale-tab'
import type { Role } from '#/shared/domain/roles'
import type { ClientAuthz } from '#/shared/domain/auth-context'
import {
  EMPTY_CAPABILITY_SET,
  getCapabilitySet,
  type CapabilitySet,
} from '#/shared/auth/capability-set'
import { readShellChecks } from '#/shared/shell-context/shell-context-checks'
import { shellCheckSide } from '#/shared/queries/shell-context-cache'
import { propertyIdFromLocation } from '#/components/hooks/use-property-id'
import { isFullBleedRoute } from '#/components/layout/full-bleed-route'
import { pageHead } from '#/components/layout/page-identity'
import { PAGE_GUTTER } from '#/components/layout/page-shell'
import { ShellNoticeBoundary } from '#/components/layout/shell-notice-boundary'
import {
  useKeepSidebarFocus,
  useRememberAppLocation,
  useSidebarOpen,
} from '#/components/layout/shell-continuity'
import { useRenderedPathname } from '#/components/layout/rendered-location'
import { ShellPresence } from '#/components/layout/route-page-state'
import { httpStatus } from '#/shared/security/expected-refusal'
import { SidebarProvider } from '#/components/ui/sidebar'
import { ViewportHintContext } from '#/components/hooks/use-viewport-below'
import { useRememberViewportWidth } from '#/components/hooks/use-remember-viewport-width'
import { UNKNOWN_VIEWPORT } from '#/components/hooks/viewport-hint'
import { ManagerSidebar } from '#/components/layout/manager-sidebar'
import { SettingsSidebar } from '#/components/layout/settings-sidebar'
import { AppTopBar } from '#/components/layout/app-top-bar'
import { hasRole } from '#/shared/domain/roles'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useSuspenseQuery } from '@tanstack/react-query'
import { propertiesQuery } from '#/routes/-queries/route-queries'
import { partitionWorkspaceProperties } from '#/components/features/property/property-workspace'
import {
  listMyBetaFeedbackFn,
  submitBetaFeedbackFn,
} from '#/contexts/identity/server/beta-feedback'
import { lazy, Suspense, type ComponentProps, type ReactNode } from 'react'

const MerchantAiNoticeUpdate = lazy(
  () => import('./_authenticated/-merchant-ai-notice-update'),
)

/**
 * What the shell knows about the person, read by every page below it.
 *
 * The server render resolves it fresh on every request. In the browser it may be up
 * to 30 seconds old (ADR 0072): `beforeLoad` reuses the last answers for the signed-in
 * person until they are stale, and forgets them on sign-in, sign-out, a tab coming
 * back, the person's own profile, Organization or member changes, and any refusal that
 * reaches a route error boundary (`invalidateShellContext`); other refusals wait out
 * the 30 seconds. So every field is a navigation
 * affordance, never an authority: each page's server functions check the session,
 * role and capability on their own, and their refusal is what the person is told.
 */
export type AuthRouteContext = Readonly<{
  /** The signed-in person; also the key every remembered shell answer sits under. */
  user: {
    id: string
    name: string
    email: string
    image: string | null
  }
  role: Role
  authz: ClientAuthz
  /**
   * Capability posture for the property in scope (ADR 0049). Resolved
   * property-scoped — not org-scoped — because policy allowlists per property
   * (`property_not_allowlisted`), so a tenant whose properties differ would get
   * the wrong answer from an org-only set. `beforeLoad` re-runs on every
   * navigation and remembers one set per Property scope, so switching property
   * reads that Property's set (asked for when there is no fresh one).
   *
   * UI affordance only: it exists so navigation can render an unavailable
   * feature as disabled instead of routing into its unavailable page. It is not a
   * security boundary — every route gate and server function still asserts.
   */
  capabilities: CapabilitySet
  activeOrganization: {
    id: string
    name: string
    slug: string
    contactEmail: string | null
  } | null
}>

/**
 * Every expected way the organization lookup fails becomes a redirect:
 *  1. isRedirect — always forward (e.g., auth middleware redirects).
 *  2. 401 — the session ended between getSession() and this call (sign-out
 *     in another tab, expiry): the same outcome as no session.
 *  3. no_active_org — expected for an account awaiting access; route to the
 *     explicit invitation/support state before the tenant shell loads.
 *  4. Everything else propagates to the route error boundary.
 */
function organizationLoadFailure(error: unknown, href: string): unknown {
  if (isRedirect(error)) return error
  if (httpStatus(error) === 401) {
    return redirect({ to: '/login', search: { redirect: href } })
  }
  const code =
    error instanceof Error && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined
  if (code === 'no_active_org') {
    return redirect({ to: '/unavailable', search: { reason: 'workspace_access' } })
  }
  return error
}

/** An Organization answer that lets the person into the shell: the only kind remembered. */
function admitsShell(org: Awaited<ReturnType<typeof getActiveOrganization>>): boolean {
  return org.availability !== 'disabled' && org.organization !== null && Boolean(org.role)
}

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ location, context }) => {
    // One stage, not three in a row. Router-core awaits every `beforeLoad` before
    // any loader starts, and this one runs on every navigation (a search-only
    // change and a hover preload too), so a chain here is a delay in front of every
    // page. The three server calls read the tenant from the same request headers
    // and none needs another's answer, so they start together:
    //  - the session;
    //  - the active Organization and the person's role;
    //  - the capability set, property-scoped when a property is in scope, because
    //    policy allowlists per property.
    // In the browser the answers are remembered for 30 seconds under the signed-in
    // person (`shell-context-checks`), so a navigation soon after the last check asks
    // nothing; the server render always asks. The decisions below keep their order:
    // no session sends the person to log in whatever the other two said.
    const scopedPropertyId = propertyIdFromLocation(location.pathname, location.search)
    const {
      session: sessionResult,
      organization: organizationResult,
      capabilities: capabilityResult,
    } = await readShellChecks({
      queryClient: context.queryClient,
      propertyId: scopedPropertyId,
      side: shellCheckSide(),
      fns: {
        session: () => getSession(),
        organization: () => getActiveOrganization(),
        capabilities: (propertyId) =>
          getCapabilitySet({ data: propertyId ? { propertyId } : {} }),
        admitsShell,
      },
    })

    if (!sessionResult.ok) throw sessionResult.error
    const session = sessionResult.value
    if (!session) {
      throw redirect({
        to: '/login',
        search: { redirect: location.href },
      })
    }

    let resolvedOrganization: Readonly<{
      role: Role
      authz: ClientAuthz
      activeOrganization: NonNullable<AuthRouteContext['activeOrganization']>
    }>

    // `availability: disabled` — the entire workspace is intentionally dark;
    // redirect before rendering any authenticated surface. Failures are
    // classified by organizationLoadFailure().
    try {
      if (!organizationResult.ok) throw organizationResult.error
      const org = organizationResult.value
      if (org.availability === 'disabled') {
        throw redirect({ to: '/unavailable', search: { feature: 'Workspace' } })
      }
      if (org.organization) {
        if (!org.role)
          throw redirect({ to: '/unavailable', search: { feature: 'Workspace' } })
        resolvedOrganization = {
          role: org.role as Role,
          authz: org.authz,
          activeOrganization: {
            id: org.organization.id,
            name: org.organization.name,
            slug: org.organization.slug,
            contactEmail: org.organization.contactEmail,
          },
        }
      } else {
        // A signed-in account without an active Organization must not enter
        // the tenant shell. Its loader immediately asks for tenant-scoped
        // Properties and would turn the expected invitation/no-access state
        // into a failed loader. Keep it outside the tenant shell and point the
        // person at the existing invitation recovery journey.
        throw redirect({
          to: '/unavailable',
          search: { reason: 'workspace_access' },
        })
      }
    } catch (e) {
      throw organizationLoadFailure(e, location.href)
    }

    // A failure yields the empty posture rather than an error — this set is a
    // navigation affordance, and the route gates remain the boundary. A redirect
    // it raised is still followed. Missing active-Organization state was handled
    // above, before any tenant shell or loader can mount.
    if (!capabilityResult.ok && isRedirect(capabilityResult.error)) {
      throw capabilityResult.error
    }

    return {
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
      },
      role: resolvedOrganization.role,
      authz: resolvedOrganization.authz,
      capabilities: capabilityResult.ok ? capabilityResult.value : EMPTY_CAPABILITY_SET,
      activeOrganization: resolvedOrganization.activeOrganization,
    } satisfies AuthRouteContext
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(propertiesQuery)
    // Read here, not in the component: loader data is what hydration reuses,
    // so the browser's first render answers exactly as the server's did.
    return { viewportHint: readViewportHint() }
  },
  // The property list rarely changes. It is cached via Query and refetched by
  // targeted invalidation after property mutations.
  staleTime: 5 * 60 * 1000, // 5 min — matches the Query staleTime
  // The tab is titled after the deepest page in the chain, whether it rendered or
  // was refused: a denied People page is still the People tab.
  head: ({ matches }) => pageHead(matches),
  component: AuthenticatedLayout,
  // The boundary for every not-found below the shell: an unknown address, a
  // Property that is not there, and the notices of `route-notice` (a role or a
  // feature that cannot open the page). A boundary replaces its route's own
  // component, so the notice draws inside a shell of its own.
  notFoundComponent: AuthenticatedNotFound,
})

/**
 * The sidebar the shell draws: Settings has its own, a manager gets the app's,
 * and a role with no navigation of its own gets none.
 */
function ShellSidebar({
  isSettings,
  isManager,
  properties,
  organizationName,
}: Readonly<{
  isSettings: boolean
  isManager: boolean
  properties: ComponentProps<typeof ManagerSidebar>['properties']
  organizationName: string | undefined
}>) {
  if (isSettings) return <SettingsSidebar />
  if (!isManager) return null
  return (
    <ManagerSidebar
      properties={properties}
      organizationName={organizationName}
      getLastVisitCount={getLastVisitCountFn}
    />
  )
}

/** The app shell around `children`: sidebar, top bar and the one padded `<main>`. */
function AuthenticatedShell({ children }: Readonly<{ children: ReactNode }>) {
  const ctx = Route.useRouteContext()
  const { viewportHint } = Route.useLoaderData()
  useRememberViewportWidth()
  const { data: propsData } = useSuspenseQuery(propertiesQuery)
  // Removed properties stay out of the navigation. They remain reachable and
  // restorable from the Properties page, which lists them under "Removed".
  const properties = partitionWorkspaceProperties(propsData.properties).workspace
  // The frame follows the page ON SCREEN, never the address the router is heading
  // for (`rendered-location`): the sidebar, the padding and the height change in the
  // same frame as the page they hold, so the old page is never drawn in the new
  // page's frame while a loader runs.
  const pathname = useRenderedPathname()
  const isSettings = pathname.startsWith('/settings')
  // A full-bleed surface (Inbox, Property Reviews, the portal workspace): it owns
  // the viewport below the top bar and scrolls its own panes. `isFullBleedRoute`
  // is the one place that says which routes those are.
  const isFullBleed = isFullBleedRoute(pathname)
  // The sidebar is the person's: one state they set with the trigger, the rail or
  // Cmd/Ctrl+B, that no navigation changes, and that the `sidebar_state` cookie
  // carries to the next load. Kept outside this component because a refusal
  // replaces the shell with a new one (see `shell-continuity`). The server's answer
  // (the loader's reading of the cookie) is what hydration starts from.
  const [sidebarOpen, setSidebarOpen] = useSidebarOpen(viewportHint?.sidebarOpen ?? true)
  useKeepSidebarFocus()
  useRememberAppLocation()
  // The launcher is offered to whoever the server lets report, which is a
  // permission and not a rank.
  const permissions = usePermissions()
  const mayReportBeta = permissions.can('feedback.beta_report')
  const isManager = hasRole(ctx.role, 'PropertyManager')

  // One tree whatever the page: the provider, sidebar, inset, top bar and `<main>`
  // are the same elements on every route, and only classes change between a padded
  // page and a full-bleed surface. Swapping the element type of the root (as a
  // wrapper that came and went did) remounted the whole shell on every crossing and
  // snapped the sidebar to its new width in one frame.
  return (
    <ViewportHintContext.Provider value={viewportHint ?? UNKNOWN_VIEWPORT}>
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        data-frame={isFullBleed ? 'surface' : 'page'}
        className={isFullBleed ? 'h-svh overflow-hidden' : undefined}
      >
        <ShellSidebar
          isSettings={isSettings}
          isManager={isManager}
          properties={properties}
          organizationName={ctx.activeOrganization?.name}
        />
        {/*
          BQC-6.8: the layout wrapper is a plain div, NOT SidebarInset — the
          vendored SidebarInset renders <main>, which nested the content <main>
          below inside it (duplicate main, main-in-main, non-unique landmarks on
          the e2e axe gate). With a div wrapper the landmarks are textbook:
          sidebar nav (landmark) + AppTopBar <header> (top-level banner) + one
          <main>. The inset-variant peer classes from SidebarInset are dead
          weight here (the app sidebars never use variant="inset").
        */}
        <div
          data-slot="sidebar-inset"
          className={`relative flex w-full flex-1 flex-col bg-background min-w-0 ${
            isFullBleed ? 'overflow-hidden' : ''
          }`}
        >
          <AppTopBar
            user={ctx.user}
            hasSidebar={isSettings || isManager}
            isFullBleed={isFullBleed}
            organizationId={ctx.activeOrganization?.id ?? 'no-active-organization'}
            notificationFns={notificationFns}
            getProductUpdatesClient={getProductUpdatesClient}
            submitBetaFeedback={mayReportBeta ? submitBetaFeedbackFn : undefined}
            listBetaFeedback={mayReportBeta ? listMyBetaFeedbackFn : undefined}
          />
          {permissions.can('ai.manage') && (
            <Suspense>
              <MerchantAiNoticeUpdate />
            </Suspense>
          )}
          {/* The only element that pads a page (PAGE_GUTTER); nothing below adds a second gutter. */}
          <main
            className={`min-w-0 flex-1 ${
              isFullBleed ? 'overflow-hidden' : `overflow-x-clip ${PAGE_GUTTER}`
            }`}
          >
            {/*
              Keyed by the lane: a padded page and a full-bleed surface are never
              the same page, and without a key React keeps the page's outer
              element and restyles it into the surface, which the browser reports
              as that whole page shifting from its padded box to the full one.
            */}
            <ShellPresence key={isFullBleed ? 'surface' : 'page'} value>
              {children}
            </ShellPresence>
          </main>
        </div>
      </SidebarProvider>
    </ViewportHintContext.Provider>
  )
}

function AuthenticatedLayout() {
  // Back at a tab left open across a deploy, a manager gets the current code at once.
  useEffect(() => watchPerson(staleTab, window), [])
  return (
    <StaffAccountFunctionsContext value={STAFF_ACCOUNT_FUNCTIONS}>
      <AuthenticatedShell>
        <Outlet />
      </AuthenticatedShell>
    </StaffAccountFunctionsContext>
  )
}

function AuthenticatedNotFound({ data }: Readonly<{ data?: unknown }>) {
  return <ShellNoticeBoundary data={data} shell={AuthenticatedShell} />
}
