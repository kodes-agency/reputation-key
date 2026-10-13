import type { IdentityMemberPropertyAccessChanged } from '../../domain/events'

/**
 * Grant one Property to a member. A grant that has lapsed is retired and
 * granted again; an active grant with another expiry is replaced by the one
 * asked for; the same grant asked again changes nothing. `buildEvent` supplies
 * the fact committed with the grant and is not called when nothing changed.
 */
export type GrantPropertyAccessCommand = Readonly<{
  organizationId: string
  propertyId: string
  userId: string
  createdBy?: string
  /** Absent grants without an expiry. */
  expiresAt?: Date
  /** Decides whether the grant already there has lapsed. */
  now: Date
  buildEvent: () => IdentityMemberPropertyAccessChanged
}>

/** Revoke the member's unrevoked grant; `buildEvent` as for a grant. */
export type RevokePropertyAccessCommand = Readonly<{
  organizationId: string
  propertyId: string
  userId: string
  reason: string
  buildEvent: () => IdentityMemberPropertyAccessChanged
}>

/** Identity's atomic PropertyAccessGrant administration seam. */
export type PolicyAdminCommandStore = Readonly<{
  grantPropertyAccess: (command: GrantPropertyAccessCommand) => Promise<void>
  revokePropertyAccess: (command: RevokePropertyAccessCommand) => Promise<void>
}>
