// Identity context — the fixed copy an invitee or an admin sees about an
// invitation. These messages reach the browser verbatim through the tagged
// error, so they never interpolate a stored status, provider wording or driver
// text. One definition each, shared by the store, its test fake and the saga.

/** The invitation is past its expiry (a lapsed pending row, or marked expired). */
export const INVITATION_EXPIRED_MESSAGE =
  'This invitation has expired. Ask your Account Admin to resend it.'

/** Accepted, cancelled, rejected, or an unknown stored status. */
export const INVITATION_INACTIVE_MESSAGE =
  'This invitation is no longer active. Ask your Account Admin for a new one.'

/** A signed-in account at another address opened the link. */
export const INVITATION_OTHER_ADDRESS_MESSAGE =
  'This invitation was sent to a different email address. Sign out and open the link again.'

/** Resend on an invitation that is no longer open. */
export const INVITATION_CONSUMED_MESSAGE =
  'This invitation was already accepted or cancelled.'

/** A Member or custom role: no beta login may hold it. */
export const INELIGIBLE_ROLE_MESSAGE =
  'This invitation is not eligible for beta manager access'

/** Registration could not complete; the cause is logged, never shown. */
export const REGISTRATION_FAILED_MESSAGE = 'Registration failed. Please try again.'

/** The invited address already has an account. */
export const ACCOUNT_EXISTS_MESSAGE =
  'An account already exists for this email. Sign in, then open your invitation link again.'
