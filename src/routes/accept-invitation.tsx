// Accept invitation route. The emailed link (`?id=`) resolves in `beforeLoad`:
// a signed-out visitor goes to sign up (new address) or sign in (existing
// account), and a signed-in one sees a confirm step. Nothing is accepted on
// load. Without an id, the signed-in list of pending invitations stays (the
// workspace-access screen links to it).

import { useRef } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod/v4'
import { authClient } from '#/shared/auth/auth-client'
import { INVITATION_ID_MAX_LENGTH } from '#/shared/domain/ids'
import {
  clearTenantCacheAfterSessionEnd,
  clearTenantCacheAfterTenantChange,
} from '#/shared/queries/tenant-cache-transition'
import { acceptInvitation } from '#/contexts/identity/server/organizations'
import {
  AcceptInvitationPage,
  InvitationLinkPage,
  InvitationLinkStateCard,
  type InvitationLink,
} from '#/components/features/identity'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { InlineLink } from '#/components/ui/inline-link'
import { useOnSessionEnd } from '#/components/hooks/use-on-session-end'
import { pendingInvitationsQuery } from './-pending-invitations-query'

/**
 * The emailed link names one invitation. Anything the router parsed into
 * something else (a repeated key's array, a number, `true`, an empty value) or
 * longer than an id the preview accepts reads as no invitation: the pending
 * list. Non-empty string, as the server's acceptInvitationInputSchema takes it.
 */
export const acceptInvitationSearch = z.object({
  id: z.string().min(1).max(INVITATION_ID_MAX_LENGTH).optional().catch(undefined),
})

export const Route = createFileRoute('/accept-invitation')({
  validateSearch: acceptInvitationSearch,
  beforeLoad: async ({ search, context }) => {
    // Loaded on demand: first-paint bytes are budgeted, and this only runs for
    // a visitor who opened an invitation link (or the signed-in list).
    const entry = await import('./-invitation-entry')
    return entry.resolveAcceptEntry(search.id, context.queryClient)
  },
  component: AcceptInvitationRoute,
})

function JoiningNotice() {
  return (
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
  )
}

function AcceptInvitationRoute() {
  const { entry } = Route.useRouteContext()
  if (entry.kind === 'unusable') return <InvitationLinkStateCard link={entry.link} />
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
  const { id } = Route.useSearch()
  const { data: session } = authClient.useSession()
  const acceptInvitationFn = useActionMutation(acceptInvitation, {
    successMessage: 'Invitation accepted',
    onSuccess: () => clearTenantCacheAfterTenantChange(queryClient),
  })
  // Once the session is gone the link goes back to /join, whose `beforeLoad`
  // now sees a signed-out visitor and sends them to sign up or sign in. This
  // page's Sign out and the header's (which navigates nowhere) both end up
  // here, and only the first one to arrive navigates: a second load of the
  // same address would read the preview again, and it is budgeted per IP.
  const handedBack = useRef(false)
  const handBack = () => {
    if (handedBack.current) return
    handedBack.current = true
    return navigate({ to: '/join', search: { invitationId: id } })
  }
  useOnSessionEnd(session != null, () => void handBack())
  const signOut = () =>
    clearTenantCacheAfterSessionEnd(
      queryClient,
      async () => {
        const result = await authClient.signOut()
        if (result.error) throw new Error('Could not sign out. Please try again.')
      },
      handBack,
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
  const { data: invitations } = useSuspenseQuery(pendingInvitationsQuery)
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
