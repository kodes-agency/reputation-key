/**
 * What an invitation link resolved to, in the terms the pages render. The route
 * maps the server's preview onto this, so components never import a use case.
 */

import type { InvitationDetails } from './shared-types'

export type InvitationLink =
  | Readonly<{
      state: 'pending'
      invitationId: string
      /** The address the invitation was sent to. */
      invitedEmail: string
      details: InvitationDetails
    }>
  | Readonly<{
      state: 'expired' | 'canceled' | 'accepted'
      organizationName: string
      inviterName: string | null
    }>
  | Readonly<{ state: 'unavailable' }>

/** Addresses are case-insensitive, and an invitation stores the one typed. */
export function emailsMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}
