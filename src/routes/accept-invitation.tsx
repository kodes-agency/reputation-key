// Accept invitation route — thin route wrapping AcceptInvitationPage
// Fixed: auto-accept now uses useEffect instead of side-effect-in-render

import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSession } from '#/shared/auth/auth.functions'
import {
  listUserInvitations,
  acceptInvitation,
} from '#/contexts/identity/server/organizations'
import { AcceptInvitationPage } from '#/components/features/identity'
import { useMutationAction } from '#/components/hooks/use-mutation-action'

export const Route = createFileRoute('/accept-invitation')({
  staleTime: 30_000,
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
      invitations: invitations.filter((inv) => inv.status === 'pending'),
    }
  },
  component: AcceptInvitationRoute,
})

function AcceptInvitationRoute() {
  const search = Route.useSearch() as { id?: string }
  const { invitations } = Route.useLoaderData()
  const acceptInvitationFn = useMutationAction(acceptInvitation, {
    successMessage: 'Invitation accepted',
    invalidateRoutes: ['/_authenticated'],
  })

  return (
    <AcceptInvitationPage
      invitationId={search.id}
      invitations={invitations}
      acceptInvitation={acceptInvitationFn}
    />
  )
}
