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
import { SidebarProvider, SidebarInset } from '#/components/ui/sidebar'
import { ManagerSidebar } from '#/components/layout/manager-sidebar'
import { StaffSidebar } from '#/components/layout/staff-sidebar'
import { SettingsSidebar } from '#/components/layout/settings-sidebar'
import { AppTopBar } from '#/components/layout/app-top-bar'
import { hasRole } from '#/shared/domain/roles'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { organizationsQuery, propertiesQuery } from '#/shared/queries/route-queries'
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

    // Error handling strategy for getActiveOrganization:
    //  1. isRedirect — always forward (e.g., auth middleware redirects).
    //  2. no_active_org — expected for new users who haven't selected an org yet;
    //     silently default to Staff role with no active organization.
    //  3. Everything else (network failures, server errors) — propagate to
    //     TanStack Router's error boundary so the user sees a real error page.
    try {
      const org = await getActiveOrganization()
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

      // Expected: new user with no active organization yet — valid empty state.
      const isNoActiveOrg =
        e instanceof Error &&
        'code' in e &&
        (e as { code: string }).code === 'no_active_org'
      if (isNoActiveOrg) {
        console.info('[beforeLoad] No active organization selected — using defaults')
      } else {
        // Unexpected error — propagate to error boundary
        throw e
      }
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
          hasTeam={false}
        />
      )}
      <SidebarInset className={`min-w-0 ${isInbox ? 'overflow-hidden' : ''}`}>
        <AppTopBar user={ctx.user} notificationFns={notificationFns} />
        <main
          className={`min-w-0 flex-1 ${
            isInbox ? 'overflow-hidden' : 'overflow-auto px-4 py-5 md:px-6 md:py-8'
          }`}
        >
          <Outlet />
        </main>
      </SidebarInset>
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
