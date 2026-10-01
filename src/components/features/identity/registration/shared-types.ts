/**
 * Shared types for the identity registration feature.
 */

export type PendingInvitation = Readonly<{
  id: string
  organizationName: string
  role: string
  expiresAt: Date
}>

/** The roles an invitation can carry in the beta. */
export type InvitationRole = 'AccountAdmin' | 'PropertyManager'

/** What an invitation link states, as its preview reports it. */
export type InvitationDetails = Readonly<{
  organizationName: string
  /** null when the inviter has since left the Organization. */
  inviterName: string | null
  role: InvitationRole
  propertyNames: ReadonlyArray<string>
  expiresAt: Date
}>
