// Accept invitation route — thin route wrapping AcceptInvitationPage
// Fixed: auto-accept now uses useEffect instead of side-effect-in-render

import { createFileRoute, redirect } from '@tanstack/react-router'
import { queryOptions, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod/v4'
import { getSession } from '#/shared/auth/auth.functions'
import { identityKeys } from '#/shared/queries/query-keys'
import { clearTenantCacheAfterTenantChange } from '#/shared/queries/tenant-cache-transition'
import {
  listUserInvitations,
  acceptInvitation,
} from '#/contexts/identity/server/organizations'
import { AcceptInvitationPage } from '#/components/features/identity'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { InlineLink } from '#/components/ui/inline-link'

// Shared query options — the loader (ensureQueryData) and component
// (useSuspenseQuery) reference the SAME options object so the primed cache is
// hit with zero extra fetch. The filter+map lives inside the queryFn so the
// cached value is the filtered invitation list.
const invitationsQuery = queryOptions({
  queryKey: identityKeys.userInvitations(),
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

/**
 * The emailed link names one invitation. Anything the router parsed into
 * something else (a repeated key's array, a number, `true`, an empty value)
 * reads as no invitation: the pending list. Non-empty string, as the server's
 * acceptInvitationInputSchema takes it.
 */
export const acceptInvitationSearch = z.object({
  id: z.string().min(1).optional().catch(undefined),
})

export const Route = createFileRoute('/accept-invitation')({
  validateSearch: acceptInvitationSearch,
  staleTime: 30_000,
  beforeLoad: async ({ search }) => {
    const session = await getSession()
    if (!session) {
      throw redirect({
        to: '/join',
        search: { invitationId: search.id },
      })
    }
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(invitationsQuery)
  },
  component: AcceptInvitationRoute,
})

function AcceptInvitationRoute() {
  const { id } = Route.useSearch()
  const { data: invitations } = useSuspenseQuery(invitationsQuery)
  const queryClient = useQueryClient()
  const acceptInvitationFn = useActionMutation(acceptInvitation, {
    successMessage: 'Invitation accepted',
    onSuccess: () => clearTenantCacheAfterTenantChange(queryClient),
  })

  return (
    <AcceptInvitationPage
      invitationId={id}
      invitations={invitations}
      acceptInvitation={acceptInvitationFn}
      joiningNotice={
        <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
          By joining you accept the{' '}
          <InlineLink to="/privacy/beta-agreement" underline="always">
            Beta Agreement
          </InlineLink>{' '}
          and the{' '}
          <InlineLink to="/privacy" underline="always">
            Privacy Notice
          </InlineLink>
          .
        </p>
      }
    />
  )
}
