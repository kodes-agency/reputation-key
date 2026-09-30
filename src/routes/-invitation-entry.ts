// What /join and /accept-invitation need to decide where a visitor goes: the
// invitation the link names and who, if anyone, is signed in. Both routes read
// it in `beforeLoad`, so a link never renders a page that cannot work.

import { redirect } from '@tanstack/react-router'
import type { InvitationLink } from '#/components/features/identity'
import { getSession } from '#/shared/auth/auth.functions'
import { getInvitationPreview } from '#/contexts/identity/server/organizations'

export type InvitationEntry = Readonly<{
  link: InvitationLink
  /** The address the invitation was sent to already has an account. */
  accountExists: boolean
  /** The signed-in address, or null for a visitor with no session. */
  signedInEmail: string | null
}>

export async function loadInvitationEntry(
  invitationId: string,
): Promise<InvitationEntry> {
  const [session, preview] = await Promise.all([
    getSession(),
    getInvitationPreview({ data: { invitationId } }),
  ])
  const signedInEmail = session?.user.email ?? null
  if (preview.state !== 'pending') {
    return { link: preview, accountExists: false, signedInEmail }
  }
  return {
    link: {
      state: 'pending',
      invitationId: preview.invitationId,
      invitedEmail: preview.email,
      details: {
        organizationName: preview.organizationName,
        inviterName: preview.inviterName,
        role: preview.role,
        propertyNames: preview.propertyNames,
        expiresAt: preview.expiresAt,
      },
    },
    accountExists: preview.accountExists,
    signedInEmail,
  }
}

/** Sign in first, then come back to the confirm step for this invitation. */
export function signInToAcceptInvitation(invitationId: string) {
  return redirect({
    to: '/login',
    search: { redirect: `/accept-invitation?id=${encodeURIComponent(invitationId)}` },
  })
}
