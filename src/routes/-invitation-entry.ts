// What /join and /accept-invitation need to decide where a visitor goes: the
// invitation the link names and who, if anyone, is signed in. Both routes read
// it in `beforeLoad`, so a link never renders a page that cannot work.
//
// The routes import this module lazily. Their `beforeLoad` hooks sit in the
// first-paint bundle, which is budgeted to the byte, while this logic is only
// needed when someone opens an invitation link (server-side for that first
// request, so the hop costs a browser nothing on the way in).

import { redirect } from '@tanstack/react-router'
import type { InvitationLink } from '#/components/features/identity'
import { getSession } from '#/shared/auth/auth.functions'
import { getInvitationPreview } from '#/contexts/identity/server/organizations'

type InvitationEntry = Readonly<{
  link: InvitationLink
  /** The address the invitation was sent to already has an account. */
  accountExists: boolean
  /** The signed-in address, or null for a visitor with no session. */
  signedInEmail: string | null
}>

async function loadInvitationEntry(invitationId: string): Promise<InvitationEntry> {
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
function signInToAcceptInvitation(invitationId: string) {
  return redirect({
    to: '/login',
    search: { redirect: `/accept-invitation?id=${encodeURIComponent(invitationId)}` },
  })
}

/** What /accept-invitation renders, decided once in `beforeLoad`. */
export type AcceptEntry =
  | Readonly<{ kind: 'list' }>
  | Readonly<{ kind: 'link'; link: InvitationLink; signedInEmail: string }>
  // Signed out, and the link needs no account to explain itself.
  | Readonly<{ kind: 'unusable'; link: Exclude<InvitationLink, { state: 'pending' }> }>

export async function resolveAcceptEntry(
  id: string | undefined,
): Promise<{ entry: AcceptEntry }> {
  if (!id) {
    if (!(await getSession())) {
      throw redirect({ to: '/join', search: { invitationId: undefined } })
    }
    return { entry: { kind: 'list' } }
  }
  const { link, accountExists, signedInEmail } = await loadInvitationEntry(id)
  if (signedInEmail !== null) {
    return { entry: { kind: 'link', link, signedInEmail } }
  }
  if (link.state !== 'pending') return { entry: { kind: 'unusable', link } }
  // An address with an account cannot sign up again: it signs in, then returns.
  if (accountExists) throw signInToAcceptInvitation(id)
  throw redirect({ to: '/join', search: { invitationId: id } })
}

/** The invitation /join acts on; null asks for one. */
export async function resolveJoinLink(
  invitationId: string | undefined,
): Promise<{ link: InvitationLink | null }> {
  if (!invitationId) {
    if (await getSession()) throw redirect({ to: '/properties' })
    return { link: null }
  }
  const { link, accountExists, signedInEmail } = await loadInvitationEntry(invitationId)
  // Signed in already: accepting is a confirm step, not a sign-up.
  if (signedInEmail !== null) {
    throw redirect({ to: '/accept-invitation', search: { id: invitationId } })
  }
  // The address has an account, so this form could only fail: sign in instead.
  if (link.state === 'pending' && accountExists) {
    throw signInToAcceptInvitation(invitationId)
  }
  return { link }
}
