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
  listUserOrganizations,
  setActiveOrganization,
} from '#/contexts/identity/server/organizations'
import { listProperties } from '#/contexts/property/server/properties'
import type { Role } from '#/shared/domain/roles'
import { SidebarProvider, SidebarInset } from '#/components/ui/sidebar'
import { ManagerSidebar } from '#/components/layout/manager-sidebar'
import { StaffSidebar } from '#/components/layout/staff-sidebar'
import { SettingsSidebar } from '#/components/layout/settings-sidebar'
import { AppTopBar } from '#/components/layout/app-top-bar'
import { hasRole } from '#/shared/domain/roles'
import { useServerFn } from '@tanstack/react-start'
import { getLogger } from '#/shared/observability/logger'

export type AuthRouteContext = Readonly<{
  user: {
    id: string
    name: string
    email: string
    image: string | null
  }
  role: Role
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

    try {
      const org = await getActiveOrganization()
      if (org.role) {
        role = org.role as Role
      }
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
      getLogger().error({ err: e }, '[beforeLoad] getActiveOrganization FAILED')
    }

    return {
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
      },
      role,
      activeOrganization,
    } satisfies AuthRouteContext
  },
  loader: async () => {
    const [orgsResult, propsResult] = await Promise.allSettled([
      listUserOrganizations(),
      listProperties(),
    ])

    if (orgsResult.status === 'rejected') {
      getLogger().error(
        { err: orgsResult.reason },
        '[loader] listUserOrganizations failed',
      )
    }
    if (propsResult.status === 'rejected') {
      getLogger().error({ err: propsResult.reason }, '[loader] listProperties failed')
    }

    const organizations =
      orgsResult.status === 'fulfilled' ? orgsResult.value.organizations : []
    const properties =
      propsResult.status === 'fulfilled' ? propsResult.value.properties : []

    return {
      organizations,
      properties,
      _debug_orgsError:
        orgsResult.status === 'rejected' ? String(orgsResult.reason) : null,
      _debug_propsError:
        propsResult.status === 'rejected' ? String(propsResult.reason) : null,
    }
  },
  // Structural data (orgs, properties) rarely changes.
  // Refetch only on explicit router.invalidate() after mutations.
  staleTime: 5 * 60 * 1000, // 5 min — structural data rarely changes
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  const ctx = Route.useRouteContext()
  const { organizations, properties } = Route.useLoaderData()
  const setActiveOrganizationFn = useServerFn(setActiveOrganization)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isSettings = pathname.startsWith('/settings')

  return (
    <SidebarProvider>
      {isSettings ? (
        <SettingsSidebar />
      ) : hasRole(ctx.role, 'PropertyManager') ? (
        <ManagerSidebar
          organizations={organizations}
          activeOrganization={ctx.activeOrganization}
          setActiveOrganization={setActiveOrganizationFn}
          properties={properties}
        />
      ) : (
        <StaffSidebar
          organizations={organizations}
          activeOrganization={ctx.activeOrganization}
          setActiveOrganization={setActiveOrganizationFn}
          // TODO: wire to real team membership query when staff context is built
          hasTeam={false}
        />
      )}
      <SidebarInset>
        <AppTopBar user={ctx.user} />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
