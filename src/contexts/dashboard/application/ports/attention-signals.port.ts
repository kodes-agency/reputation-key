// Dashboard context — AttentionSignalsPort (facade port per ADR-0007)
// Count queries for the property "attention band" — what needs a manager's eye.
// Dashboard never imports review/inbox/goal tables directly — this port is the boundary.

import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

export type AttentionCounts = Readonly<{
  unanswered: number
  itemsToTriage: number
  escalated: number
  goalsBehindPace: number
  /** Distinct Review, Inbox-source, and Goal anchors. */
  attentionWork: number
}>

/** Atomic property attention projection; overlapping reasons share one snapshot. */
export type AttentionSignalsPort = Readonly<{
  getAttentionCounts(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    slaHours: number,
  ): Promise<AttentionCounts>
}>
