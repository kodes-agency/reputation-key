// Authenticated layout route — protects all nested routes and renders the app shell.
// Per better-auth TanStack Start docs: use createServerFn (getSession)
// in beforeLoad — not authClient.getSession(), which can't forward cookies during SSR.
import { createFileRoute, Outlet, redirect, isRedirect } from '@tanstack/react-router'
import { getSession } from '#/shared/auth/auth.functions'
import {
  getActiveOrganization,
  listUserOrganizations,
} from '#/contexts/identity/server/organizations'
import { listProperties } from '#/contexts/property/server/properties'
import { toDomainRole } from '#/shared/domain/roles'
import type { Role } from '#/shared/domain/roles'
import { SidebarProvider, SidebarInset } from '#/components/ui/sidebar'
import { AppSidebar } from '#/components/layout/AppSidebar'
import { AppTopBar } from '#/components/layout/AppTopBar'

export type AuthRouteContext = Readonly<{
  user: {
    id: string
    name: string
    email: string
    image: string | null
  }
  role: Role
  activeOrganization: { id: string; name: string } | null
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
    let activeOrganization: { id: string; name: string } | null = null

    try {
      const org = await getActiveOrganization()
      if (org.role) {
        role = toDomainRole(org.role)
      }
      if (org.organization) {
        activeOrganization = {
          id: org.organization.id,
          name: org.organization.name,
        }
      }
    } catch (e) {
      if (isRedirect(e)) throw e
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
      console.error('[loader] listUserOrganizations failed:', orgsResult.reason)
    }
    if (propsResult.status === 'rejected') {
      console.error('[loader] listProperties failed:', propsResult.reason)
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
  staleTime: Infinity,
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  const ctx = Route.useRouteContext()
  const { organizations, properties } = Route.useLoaderData()

  return (
    <SidebarProvider>
      <AppSidebar
        role={ctx.role}
        organizations={organizations}
        activeOrganization={ctx.activeOrganization}
      />
      <SidebarInset>
        <AppTopBar user={ctx.user} properties={properties} />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
