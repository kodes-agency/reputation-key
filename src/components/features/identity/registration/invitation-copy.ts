/**
 * The words on the invitation link pages. Pure, so the copy is tested without
 * rendering and the components stay layout only.
 */

import type { InvitationRole } from './shared-types'

export type InvitationUnusableState = 'expired' | 'canceled' | 'accepted' | 'unavailable'

type StateInput = Readonly<{
  state: InvitationUnusableState
  organizationName?: string
  inviterName?: string | null
  /** Changes where the way out leads: a signed-in reader has no sign-in to do. */
  signedIn: boolean
}>

export type InvitationStateCopy = Readonly<{
  title: string
  description: string
  /** Always a way on, so a dead link never strands the reader. */
  action: Readonly<{ label: string; to: '/login' | '/properties' }>
}>

/** Who can fix a dead invitation: the person who sent it, else their Organization. */
function whoToAsk(input: StateInput): string {
  if (input.inviterName) return input.inviterName
  return input.organizationName
    ? `an Account Admin at ${input.organizationName}`
    : 'your Account Admin'
}

export function invitationStateCopy(input: StateInput): InvitationStateCopy {
  const action = input.signedIn
    ? ({ label: 'Go to your workspace', to: '/properties' } as const)
    : ({ label: 'Sign in', to: '/login' } as const)
  switch (input.state) {
    case 'expired':
      return {
        title: 'This invitation has expired',
        description: `Ask ${whoToAsk(input)} to resend it, then open the link in the new email.`,
        action,
      }
    case 'canceled':
      return {
        title: 'This invitation was cancelled',
        description: `Ask ${whoToAsk(input)} to send you a new invitation.`,
        action,
      }
    case 'accepted':
      return {
        title: 'This invitation was already used',
        description: input.signedIn
          ? 'It has been accepted, so there is nothing more to do here.'
          : 'It has been accepted. Sign in to continue.',
        action,
      }
    case 'unavailable':
      return {
        title: "This invitation link isn't valid",
        description:
          'Open the link from your invitation email again, or ask your Account Admin to send a new one.',
        action,
      }
  }
}

export function invitationMismatchCopy(
  invitedEmail: string,
  signedInEmail: string,
): Readonly<{ title: string; description: string }> {
  return {
    title: 'This invitation is for another address',
    description: `It was sent to ${invitedEmail}, but you are signed in as ${signedInEmail}. Sign out to continue with the invited address.`,
  }
}

/** Most Properties a summary names before folding the rest into a count. */
const MAX_NAMED_PROPERTIES = 8

export function invitationPropertyLines(
  role: InvitationRole,
  propertyNames: ReadonlyArray<string>,
): ReadonlyArray<string> {
  if (role === 'AccountAdmin') return ['Every Property in the Organization']
  if (propertyNames.length === 0) return ['None assigned yet']
  if (propertyNames.length <= MAX_NAMED_PROPERTIES + 1) return propertyNames
  const hidden = propertyNames.length - MAX_NAMED_PROPERTIES
  return [...propertyNames.slice(0, MAX_NAMED_PROPERTIES), `and ${hidden} more`]
}

/**
 * A day, in UTC, with a pinned locale: the server renders this page and the
 * browser hydrates it, and a zone or locale difference between them is a
 * hydration mismatch.
 */
export function formatInvitationExpiry(expiresAt: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(expiresAt)
}
