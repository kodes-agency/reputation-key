// What /join and /accept-invitation need to decide where a visitor goes: the
// invitation the link names and who, if anyone, is signed in. Both routes read
// it in `beforeLoad`, so a link never renders a page that cannot work.
//
// The routes import this module lazily. Their `beforeLoad` hooks sit in the
// first-paint bundle, which is budgeted to the byte, while this logic is only
// needed when someone opens an invitation link (server-side for that first
// request, so the hop costs a browser nothing on the way in).

import { redirect } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import type {
  InvitationLink,
  UnusableInvitationLink,
} from '#/components/features/identity'
import { getSession } from '#/shared/auth/auth.functions'
import { getInvitationPreview } from '#/contexts/identity/server/organizations'
import { pendingInvitationsQuery } from './-pending-invitations-query'

type InvitationEntry = Readonly<{
  link: InvitationLink
  /** The address the invitation was sent to already has an account. */
  accountExists: boolean
  /** The signed-in address, or null for a visitor with no session. */
  signedInEmail: string | null
}>

const RATE_LIMITED_LINK: UnusableInvitationLink = { state: 'rate_limited' }

/**
 * The preview's per-IP limit is an expected state, not a fault: opening a link
 * spends some of it, so a shared address can run out. Recognised by the code
 * the server throws (the shape `isServerFunctionError` checks, without
 * importing it: that module is part of first paint, and a second, lazy
 * importer would split it into a chunk of its own in the budgeted closure).
 * Anything else is a real failure and keeps going to the error page, where it
 * is reported.
 */
function isRateLimited(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as Error & { code?: unknown }).code === 'rate_limited'
  )
}

async function readPreview(invitationId: string) {
  try {
    return await getInvitationPreview({ data: { invitationId } })
  } catch (error) {
    if (isRateLimited(error)) return RATE_LIMITED_LINK
    throw error
  }
}

async function loadInvitationEntry(invitationId: string): Promise<InvitationEntry> {
  const [session, preview] = await Promise.all([getSession(), readPreview(invitationId)])
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
  | Readonly<{ kind: 'unusable'; link: UnusableInvitationLink }>

export async function resolveAcceptEntry(
  id: string | undefined,
  queryClient: Pick<QueryClient, 'ensureQueryData'>,
): Promise<{ entry: AcceptEntry }> {
  if (!id) {
    if (!(await getSession())) {
      throw redirect({ to: '/join', search: { invitationId: undefined } })
    }
    // The list page reads this same query; priming it here, where the page is
    // chosen, keeps a `loader` (and its code) out of the first-paint bundle.
    await queryClient.ensureQueryData(pendingInvitationsQuery)
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
