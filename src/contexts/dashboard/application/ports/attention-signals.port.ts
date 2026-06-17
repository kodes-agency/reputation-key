// Dashboard context — AttentionSignalsPort (facade port per ADR-0007)
// Count queries for the property "attention band" — what needs a manager's eye.
// Dashboard never imports review/inbox/goal tables directly — this port is the boundary.

import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

/**
 * Facade port for the property attention-band counts.
 * Each method counts items that warrant attention for a single property.
 */
export type AttentionSignalsPort = Readonly<{
  /**
   * Reviews with no published reply AND age (now − reviewedAt) greater than
   * the response SLA. The SLA is an org-level setting (hours).
   */
  getUnansweredReviewCount(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    slaHours: number,
  ): Promise<number>

  /** Inbox items in 'new' status for the property (unactioned feedback). */
  getNewInboxItemCount(
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ): Promise<number>

  /** Inbox items in 'escalated' status for the property. */
  getEscalatedInboxItemCount(
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ): Promise<number>

  /**
   * Active goals whose current progress is behind the pro-rated expected
   * progress for the elapsed period. Only bounded, not-yet-ended goals count.
   */
  getGoalsBehindPaceCount(
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ): Promise<number>
}>
