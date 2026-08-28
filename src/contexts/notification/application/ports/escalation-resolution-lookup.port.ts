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
  resolvedAt: Date | null
  resolvedBy: UserId | null
}>

export type EscalationResolutionLookupPort = Readonly<{
  findEscalationResolutionFacts(
    inboxItemId: InboxItemId,
    organizationId: OrganizationId,
  ): Promise<EscalationResolutionNotificationFacts | null>
}>
