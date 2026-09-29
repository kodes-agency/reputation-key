import type { InboxItemId, OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'

/**
 * Content-free current state used to fence escalation-resolution delivery.
 *
 * The resolution timestamp and actor identify the exact resolution fact. A
 * later re-escalation or resolution must not inherit an earlier event's queued
 * recipients.
 */
export type EscalationResolutionNotificationFacts = Readonly<{
  propertyId: PropertyId
  assignedTo: UserId | null
  propertyName: string | null
  isEscalated: boolean
  /**
   * When the escalation this resolution closes was raised. It bounds the
   * evidence of who was told about it: an earlier escalation's notices went
   * to people this one may never have reached.
   */
  escalatedAt: Date | null
  resolvedAt: Date | null
  resolvedBy: UserId | null
}>

export type EscalationResolutionLookupPort = Readonly<{
  findEscalationResolutionFacts(
    inboxItemId: InboxItemId,
    organizationId: OrganizationId,
  ): Promise<EscalationResolutionNotificationFacts | null>
}>
