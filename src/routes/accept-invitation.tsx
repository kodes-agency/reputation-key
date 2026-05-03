// Accept invitation route — thin route wrapping AcceptInvitationPage
// Fixed: auto-accept now uses useEffect instead of side-effect-in-render

import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSession } from '#/shared/auth/auth.functions'
import {
  listUserInvitations,
  acceptInvitation,
} from '#/contexts/identity/server/organizations'
import { AcceptInvitationPage } from '#/components/features/identity/AcceptInvitationPage'
import { useServerFn } from '@tanstack/react-start'

export const Route = createFileRoute('/accept-invitation')({
  beforeLoad: async ({ location }) => {
    const session = await getSession()
    if (!session) {
      throw redirect({
        to: '/join',
        search: { redirect: location.href },
      })
    }
  },
  loader: async () => {
    const { invitations } = await listUserInvitations()
    return {
      invitations: invitations.filter(
        (inv: { status: string }) => inv.status === 'pending',
      ),
    }
  },
  component: AcceptInvitationRoute,
})

function AcceptInvitationRoute() {
  const search = Route.useSearch() as { id?: string }
  const { invitations } = Route.useLoaderData()
  const acceptInvitationFn = useServerFn(acceptInvitation)

  return (
    <AcceptInvitationPage
      invitationId={search.id}
      invitations={invitations}
      acceptInvitation={acceptInvitationFn}
    />
  )
}
