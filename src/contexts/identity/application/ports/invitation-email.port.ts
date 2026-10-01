// Identity context — the invitation email every invitation path sends.
//
// One contract for the first send (invite-member), a renewal (resend-invitation)
// and the operator console. `shared/auth/emails.ts` `InvitationEmailParams` is
// structurally identical, so composition passes `sendInvitationEmail` as the
// sender without an adapter.

export type InvitationEmail = Readonly<{
  email: string
  invitedByUsername: string
  organizationName: string
  /** absoluteUrl(baseUrl, '/accept-invitation', { id }) */
  inviteLink: string
  role: 'AccountAdmin' | 'PropertyManager'
  /** The invited Properties' names; [] for an AccountAdmin. */
  propertyNames: ReadonlyArray<string>
  /** invitationExpiresInDays(invitationExpiresInMs) — true at send time. */
  expiresInDays: number
}>

export type InvitationEmailSender = (email: InvitationEmail) => Promise<void>
