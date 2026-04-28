// Authenticated layout route — protects all nested routes
// Per better-auth TanStack Start docs: use createServerFn (getSession)
// in beforeLoad — not authClient.getSession(), which can't forward cookies during SSR.
import { createFileRoute, Outlet, redirect, isRedirect } from '@tanstack/react-router'
import { getSession } from '#/shared/auth/auth.functions'
import { getActiveOrganization } from '#/contexts/identity/server/organizations'
import type { Role } from '#/shared/domain/roles'

export type AuthRouteContext = Readonly<{
  user: { id: string; name: string; email: string; image: string | null }
  role: Role
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

    // Resolve the user's role in the active organization
    let role: Role = 'Staff'
    try {
      const org = await getActiveOrganization()
      if (org.role) {
        role = org.role
      }
    } catch (e) {
      // Re-throw redirects — they must not be swallowed
      if (isRedirect(e)) throw e
      // If org resolution fails (e.g., no active org), default to Staff role.
      // The user will see the dashboard which handles org selection.
    }

    return {
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
      },
      role,
    } satisfies AuthRouteContext
  },
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  return <Outlet />
}
