// Authenticated layout route — protects all nested routes and renders the app shell.
// Per better-auth TanStack Start docs: use createServerFn (getSession)
// in beforeLoad — not authClient.getSession(), which can't forward cookies during SSR.
import {
  createFileRoute,
  Outlet,
  redirect,
  isRedirect,
  useRouterState,
} from '@tanstack/react-router'
import { getSession } from '#/shared/auth/auth.functions'
import {
  getActiveOrganization,
  setActiveOrganization,
} from '#/contexts/identity/server/organizations'
import { getLastVisitCountFn } from '#/contexts/inbox/server/inbox'
import { notificationFns } from '#/routes/-notification-fns'
import type { Role } from '#/shared/domain/roles'
import type { ClientAuthz } from '#/shared/domain/auth-context'
import { EMPTY_CLIENT_AUTHZ } from '#/shared/domain/auth-context'
import {
  EMPTY_CAPABILITY_SET,
  getCapabilitySet,
  type CapabilitySet,
} from '#/shared/auth/capability-set'
import { propertyIdFromLocation } from '#/components/hooks/use-property-id'
import { SidebarProvider } from '#/components/ui/sidebar'
import { ManagerSidebar } from '#/components/layout/manager-sidebar'
import { StaffSidebar } from '#/components/layout/staff-sidebar'
import { SettingsSidebar } from '#/components/layout/settings-sidebar'
import { AppTopBar } from '#/components/layout/app-top-bar'
import { hasRole } from '#/shared/domain/roles'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { organizationsQuery, propertiesQuery } from '#/routes/-queries/route-queries'
import { identityKeys, propertyKeys } from '#/shared/queries/query-keys'

export type AuthRouteContext = Readonly<{
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
   * navigation, so switching property re-resolves it.
   *
   * UI affordance only: it exists so navigation can render an unavailable
   * feature as disabled instead of routing into `/unavailable`. It is not a
   * security boundary — every route gate and server function still asserts.
   */
  capabilities: CapabilitySet
  activeOrganization: {
    id: string
    name: string
    slug: string
    contactEmail: string | null
    billingCompanyName: string | null
    billingAddress: string | null
    billingCity: string | null
    billingPostalCode: string | null
    billingCountry: string | null
  } | null
}>

type CapabilityResolution =
  | Readonly<{ ok: true; capabilities: CapabilitySet }>
  | Readonly<{ ok: false; error: unknown }>

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ location }) => {
    const session = await getSession()
    if (!session) {
      throw redirect({
        to: '/login',
        search: { redirect: location.href },
      })
    }

    let role: Role = 'Staff'
    let authz: ClientAuthz = EMPTY_CLIENT_AUTHZ
    let activeOrganization: {
      id: string
      name: string
      slug: string
      contactEmail: string | null
      billingCompanyName: string | null
      billingAddress: string | null
      billingCity: string | null
      billingPostalCode: string | null
      billingCountry: string | null
    } | null = null

    // Resolved in parallel with the organization lookup: it reads the tenant
    // from the same request headers and does not depend on that result.
    // Property-scoped when a property is in scope, because policy allowlists
    // per property. A failure (no active org yet, transient) yields the empty
    // posture rather than an error — this set is a navigation affordance, and
    // the route gates remain the boundary.
    const scopedPropertyId = propertyIdFromLocation(location.pathname, location.search)
    const capabilitiesPromise: Promise<CapabilityResolution> = getCapabilitySet({
      data: scopedPropertyId ? { propertyId: scopedPropertyId } : {},
    }).then(
      (capabilities) => ({ ok: true, capabilities }),
      (error: unknown) => ({ ok: false, error }),
    )

    // Error handling strategy for getActiveOrganization:
    //  1. isRedirect — always forward (e.g., auth middleware redirects).
    //  2. availability: disabled — the entire workspace is intentionally dark;
    //     redirect before rendering any authenticated surface.
    //  3. no_active_org — expected for new users who haven't selected an org yet;
    //     silently default to Staff role with no active organization.
    //  4. Everything else — propagate to the route error boundary.
    try {
      const org = await getActiveOrganization()
      if (org.availability === 'disabled') {
        throw redirect({ to: '/unavailable', search: { feature: 'Workspace' } })
      }
      if (org.role) {
        role = org.role as Role
      }
      authz = org.authz
      if (org.organization) {
        activeOrganization = {
          id: org.organization.id,
          name: org.organization.name,
          slug: org.organization.slug,
          contactEmail: org.organization.contactEmail,
          billingCompanyName: org.organization.billingCompanyName,
          billingAddress: org.organization.billingAddress,
          billingCity: org.organization.billingCity,
          billingPostalCode: org.organization.billingPostalCode,
          billingCountry: org.organization.billingCountry,
        }
      }
    } catch (e) {
      if (isRedirect(e)) throw e

      const errorCode =
        e instanceof Error &&
        'code' in e &&
        typeof (e as { code?: unknown }).code === 'string'
          ? (e as { code: string }).code
          : null
      if (errorCode === 'no_active_org') {
        console.info('[beforeLoad] No active organization selected — using defaults')
      } else {
        // Unexpected error — propagate to error boundary.
        throw e
      }
    }

    const capabilityResolution = await capabilitiesPromise
    if (!capabilityResolution.ok && isRedirect(capabilityResolution.error)) {
      throw capabilityResolution.error
    }

    return {
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
      },
      role,
      authz,
      capabilities: capabilityResolution.ok
        ? capabilityResolution.capabilities
        : EMPTY_CAPABILITY_SET,
      activeOrganization,
    } satisfies AuthRouteContext
  },
  loader: async ({ context }) => {
    const [orgs, props] = await Promise.all([
      context.queryClient.ensureQueryData(organizationsQuery),
      context.queryClient.ensureQueryData(propertiesQuery),
    ])
    return {
      organizations: orgs.organizations,
      properties: props.properties,
    }
  },
  // Structural data (orgs, properties) rarely changes. Cached via Query
  // (organizationsQuery/propertiesQuery, 5-min staleTime); refetched by
  // targeted key invalidation after org-switching mutations.
  staleTime: 5 * 60 * 1000, // 5 min — matches the Query staleTime
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  const ctx = Route.useRouteContext()
  const { data: orgsData } = useSuspenseQuery(organizationsQuery)
  const { data: propsData } = useSuspenseQuery(propertiesQuery)
  const organizations = orgsData.organizations
  const properties = propsData.properties
  const setActiveOrganizationFn = useActionMutation(setActiveOrganization, {
    invalidateKeys: [identityKeys.organizations(), propertyKeys.list()],
  })
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isSettings = pathname.startsWith('/settings')
  const isInbox = pathname.startsWith('/inbox') || pathname.includes('/reviews')

  const content = (
    <SidebarProvider>
      {isInbox ? null : isSettings ? (
        <SettingsSidebar />
      ) : hasRole(ctx.role, 'PropertyManager') ? (
        <ManagerSidebar properties={properties} getLastVisitCount={getLastVisitCountFn} />
      ) : (
        <StaffSidebar
          organizations={organizations}
          properties={properties}
          activeOrganization={ctx.activeOrganization}
          setActiveOrganization={setActiveOrganizationFn}
        />
      )}
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
          isInbox ? 'overflow-hidden' : ''
        }`}
      >
        <AppTopBar
          user={ctx.user}
          organizationId={ctx.activeOrganization?.id ?? 'no-active-organization'}
          notificationFns={notificationFns}
        />
        <main
          className={`min-w-0 flex-1 ${
            isInbox ? 'overflow-hidden' : 'overflow-auto px-4 py-5 md:px-6 md:py-8'
          }`}
        >
          <Outlet />
        </main>
      </div>
    </SidebarProvider>
  )

  return isInbox ? (
    <div className="h-screen overflow-hidden flex flex-col">
      <style>{`[data-slot="sidebar-wrapper"]{flex:1 1 0%;overflow:hidden}`}</style>
      {content}
    </div>
  ) : (
    content
  )
}
