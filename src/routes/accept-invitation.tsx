// Accept invitation route. The emailed link (`?id=`) resolves in `beforeLoad`:
// a signed-out visitor goes to sign up (new address) or sign in (existing
// account), and a signed-in one sees a confirm step. Nothing is accepted on
// load. Without an id, the signed-in list of pending invitations stays (the
// workspace-access screen links to it).

import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { queryOptions, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod/v4'
import { authClient } from '#/shared/auth/auth-client'
import { identityKeys } from '#/shared/queries/query-keys'
import {
  clearTenantCacheAfterSessionEnd,
  clearTenantCacheAfterTenantChange,
} from '#/shared/queries/tenant-cache-transition'
import {
  listUserInvitations,
  acceptInvitation,
} from '#/contexts/identity/server/organizations'
import {
  AcceptInvitationPage,
  InvitationLinkPage,
  InvitationStateCard,
  type InvitationLink,
} from '#/components/features/identity'
import { useActionMutation } from '#/components/hooks/use-action-mutation'

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
    // Loaded on demand: first-paint bytes are budgeted, and this only runs for
    // a visitor who opened an invitation link.
    const { resolveAcceptEntry } = await import('./-invitation-entry')
    return resolveAcceptEntry(search.id)
  },
  loader: async ({ context }) => {
    if (context.entry.kind === 'list') {
      await context.queryClient.ensureQueryData(invitationsQuery)
    }
  },
  component: AcceptInvitationRoute,
})

function JoiningNotice() {
  return (
    <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
      By joining you accept the{' '}
      <Link
        to="/privacy/beta-agreement"
        className="font-medium text-link underline underline-offset-4"
      >
        Beta Agreement
      </Link>{' '}
      and the{' '}
      <Link to="/privacy" className="font-medium text-link underline underline-offset-4">
        Privacy Notice
      </Link>
      .
    </p>
  )
}

function AcceptInvitationRoute() {
  const { entry } = Route.useRouteContext()
  if (entry.kind === 'unusable') {
    const { link } = entry
    return link.state === 'unavailable' ? (
      <InvitationStateCard state="unavailable" />
    ) : (
      <InvitationStateCard
        state={link.state}
        organizationName={link.organizationName}
        inviterName={link.inviterName}
      />
    )
  }
  if (entry.kind === 'link') {
    return <InvitationLinkRoute link={entry.link} signedInEmail={entry.signedInEmail} />
  }
  return <PendingInvitationsRoute />
}

function InvitationLinkRoute({
  link,
  signedInEmail,
}: Readonly<{ link: InvitationLink; signedInEmail: string }>) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const acceptInvitationFn = useActionMutation(acceptInvitation, {
    successMessage: 'Invitation accepted',
    onSuccess: () => clearTenantCacheAfterTenantChange(queryClient),
  })
  // Signing out hands the link back to /join, whose `beforeLoad` now sees a
  // signed-out visitor and sends them to sign up or sign in.
  const signOut = () =>
    clearTenantCacheAfterSessionEnd(
      queryClient,
      async () => {
        const result = await authClient.signOut()
        if (result.error) throw new Error('Could not sign out. Please try again.')
      },
      () =>
        navigate({
          to: '/join',
          search: {
            invitationId: link.state === 'pending' ? link.invitationId : undefined,
          },
        }),
    )

  return (
    <InvitationLinkPage
      link={link}
      signedInEmail={signedInEmail}
      acceptInvitation={acceptInvitationFn}
      signOut={signOut}
      joiningNotice={<JoiningNotice />}
    />
  )
}

function PendingInvitationsRoute() {
  const { data: invitations } = useSuspenseQuery(invitationsQuery)
  const queryClient = useQueryClient()
  const acceptInvitationFn = useActionMutation(acceptInvitation, {
    successMessage: 'Invitation accepted',
    onSuccess: () => clearTenantCacheAfterTenantChange(queryClient),
  })

  return (
    <AcceptInvitationPage
      invitations={invitations}
      acceptInvitation={acceptInvitationFn}
      joiningNotice={<JoiningNotice />}
    />
  )
}
