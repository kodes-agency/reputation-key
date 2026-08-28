import type { ContactRequestScope } from '../../domain/contact-request'

export type ContactRequestGuestAuthority = Readonly<{
  /** Complete Cookie header carrying the signed `rk_guest_session` value. */
  signedSession: string
  csrfNonce: string
}>

/**
 * Public response authority. The adapter owns signed-session verification,
 * CSRF comparison, response binding, and the 24-hour recovery deadline.
 */
export type ContactRequestResponseAuthorityPort = Readonly<{
  authorize(input: {
    action: 'submit' | 'withdraw'
    scope: ContactRequestScope
    responseId: string
    authority: ContactRequestGuestAuthority
    at: Date
  }): Promise<boolean>
}>
