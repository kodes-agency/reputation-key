// Accept invitation route — thin route wrapping AcceptInvitationPage
// Fixed: auto-accept now uses useEffect instead of side-effect-in-render

import { createFileRoute, redirect } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { getSession } from '#/shared/auth/auth.functions'
import { identityKeys, propertyKeys } from '#/shared/queries/query-keys'
import {
  listUserInvitations,
  acceptInvitation,
} from '#/contexts/identity/server/organizations'
import { AcceptInvitationPage } from '#/components/features/identity'
import { useActionMutation } from '#/components/hooks/use-action-mutation'

// Shared query options — the loader (ensureQueryData) and component
// (useSuspenseQuery) reference the SAME options object so the primed cache is
// hit with zero extra fetch. The filter+map lives inside the queryFn so the
// cached value is the filtered invitation list.
const invitationsQuery = queryOptions({
  queryKey: identityKeys.invitations(),
  queryFn: async () => {
    const { invitations } = await listUserInvitations()
    return invitations
      .filter((inv) => inv.status === 'pending')
      .map((inv) => ({
        id: inv.id,
        organizationName: inv.organizationName ?? 'Unknown Organization',
        role: inv.role ?? inv.rawRole,
        expiresAt: inv.expiresAt,
      }))
  },
  staleTime: 30_000,
})

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
  loader: async ({ context }) => {
    const invitations = await context.queryClient.ensureQueryData(invitationsQuery)
    return { invitations }
  },
  component: AcceptInvitationRoute,
})

function AcceptInvitationRoute() {
  const search = Route.useSearch() as { id?: string }
  const { data: invitations } = useSuspenseQuery(invitationsQuery)
  const acceptInvitationFn = useActionMutation(acceptInvitation, {
    successMessage: 'Invitation accepted',
    invalidateKeys: [
      identityKeys.organizations(),
      propertyKeys.list(),
      identityKeys.invitations(),
    ],
  })

  return (
    <AcceptInvitationPage
      invitationId={search.id}
      invitations={invitations}
      acceptInvitation={acceptInvitationFn}
    />
  )
}
