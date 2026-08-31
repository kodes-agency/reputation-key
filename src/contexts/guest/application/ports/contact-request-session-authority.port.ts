import type { GuestSession } from '../../domain/guest-session'
import type { ContactRequestScope } from '../../domain/contact-request'

/** Signed-cookie and CSRF verification owned by Guest's public session boundary. */
export type ContactRequestSessionAuthorityPort = Readonly<{
  verify(cookieHeader: string, scope: ContactRequestScope): GuestSession | null
  verifyCsrf(session: GuestSession, presented: string): boolean
}>
