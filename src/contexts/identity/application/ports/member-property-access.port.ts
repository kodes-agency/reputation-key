// Member Property access — AccountAdmins edit which Properties a
// PropertyManager can work from Members. The store owns the grant rows and
// commits every grant, revoke and the identity.member.property_access_changed
// fact in one transaction.

import type { OrganizationId, UserId } from '#/shared/domain/ids'
import type { IdentityMemberPropertyAccessChanged } from '../../domain/events'

/** One member's current (unrevoked, unexpired) Property grants. */
export type MemberPropertyAccess = Readonly<{
  userId: string
  propertyIds: ReadonlyArray<string>
}>

/** The Properties a change actually granted and revoked; repeats are absent. */
export type AppliedPropertyAccess = Readonly<{
  grantedPropertyIds: ReadonlyArray<string>
  revokedPropertyIds: ReadonlyArray<string>
}>

/**
 * Grant and revoke one PropertyManager's Properties. Takes the operator
 * grant lock per Property (sorted), locks the membership and refuses anything
 * but a PropertyManager (`forbidden`), refuses a Property outside the
 * Organization or deleted (`validation_error`), and writes the fact from
 * `buildEvent` only when something changed.
 */
export type SetPropertyAccessCommand = Readonly<{
  organizationId: OrganizationId
  userId: UserId
  actorUserId: UserId
  grantPropertyIds: ReadonlyArray<string>
  revokePropertyIds: ReadonlyArray<string>
  now: Date
  buildEvent: (applied: AppliedPropertyAccess) => IdentityMemberPropertyAccessChanged
}>

export type MemberPropertyAccessStore = Readonly<{
  /** Active grants per member, for the Organization's live Properties. */
  listActiveByOrganization(
    organizationId: OrganizationId,
    at: Date,
  ): Promise<ReadonlyArray<MemberPropertyAccess>>
  setPropertyAccess(command: SetPropertyAccessCommand): Promise<AppliedPropertyAccess>
}>
