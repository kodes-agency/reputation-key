// Authenticated layout route — protects all nested routes
// Any route under `src/routes/_authenticated/` requires a valid session.
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { authClient } from '#/shared/auth/auth-client'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ location }) => {
    const { data: session } = await authClient.getSession()
    if (!session) {
      throw redirect({
        to: '/login',
        search: { redirect: location.href },
      })
    }
  },
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  return <Outlet />
}
