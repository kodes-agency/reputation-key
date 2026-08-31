// LIF-01-T21 — transfer-first offboarding.
//
// `MemberAuthorityLifecyclePort.releaseMemberAuthorities` RELEASES what a
// departing member held; nobody picks it up. That is the correct behaviour for
// an involuntary removal by an AccountAdmin, who is present to reassign
// afterwards. It is the WRONG behaviour for a voluntary leave: the person
// walking out is the only one who knows what they were carrying, and a Portal
// or Property left with no Responsible Manager is a compliance gap, not an
// inbox item.
//
// This port therefore models the transfer, not the release. Everything it
// carries is an identifier or an enum — no Portal name, Property name or Inbox
// subject ever crosses it.

export const OFFBOARDING_RESPONSIBILITY_KINDS = [
  'portal_responsibility',
  'property_responsibility',
  'inbox_assignment',
] as const

export type OffboardingResponsibilityKind =
  (typeof OFFBOARDING_RESPONSIBILITY_KINDS)[number]

export type OutstandingResponsibility = Readonly<{
  kind: OffboardingResponsibilityKind
  /** Portal id, Property id or Inbox item id — never a display name. */
  resourceId: string
}>

export type ResponsibilityTransfer = Readonly<{
  kind: OffboardingResponsibilityKind
  resourceId: string
  /** Must be an eligible CURRENT manager at the moment of transfer. */
  toUserId: string
}>

export type MemberOffboardingPort = Readonly<{
  /**
   * Everything the user still holds. An empty list is the ONLY state from
   * which a leave may proceed, and it is re-read after the transfers are
   * applied so a concurrently created assignment cannot slip through.
   */
  listOutstanding(
    organizationId: string,
    userId: string,
  ): Promise<readonly OutstandingResponsibility[]>
  /** Current, eligible manager who may receive a responsibility. */
  isEligibleRecipient(input: {
    organizationId: string
    userId: string
    kind: OffboardingResponsibilityKind
    resourceId: string
  }): Promise<boolean>
  /** Applies one transfer. Idempotent for an already-transferred resource. */
  transfer(input: {
    organizationId: string
    fromUserId: string
    actorUserId: string
    transfer: ResponsibilityTransfer
  }): Promise<void>
}>
