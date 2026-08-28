// Database adapter for the InboxItemLookupPort (ADR 0022).
// Resolves a review to its inbox item via the inbox_items unique index on
// (source_type, source_id, organization_id) — at most one row — and reads the
// content-free render facts (ADR 0046 r.8) the events do not carry. The
// property join mirrors notification-property-scope.repository.ts, which
// already reads `properties` from this context.
import type { Database } from '#/shared/db'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import {
  inboxHandlingCycleHeads,
  inboxHandlingCycleResponseTargets,
  inboxItems,
  inboxResponseTargetReminders,
} from '#/shared/db/schema/inbox.schema'
import { properties } from '#/shared/db/schema/property.schema'
import {
  feedbackId,
  inboxItemId,
  userId,
  unbrand,
  type ReviewId,
  type OrganizationId,
  type InboxItemId,
} from '#/shared/domain/ids'
import type {
  HandlingCycleNotificationFacts,
  InboxItemFacts,
  InboxItemLookupPort,
  ResponseTargetReminderNotificationFacts,
} from '../../application/ports/inbox-item-lookup.port'
import type { FeedbackPortalLookupPort } from '../../application/ports/feedback-portal-lookup.port'

const findInboxItemFacts = async (
  db: Database,
  feedbackPortalLookup: FeedbackPortalLookupPort,
  id: InboxItemId,
  orgId: OrganizationId,
): Promise<InboxItemFacts | null> => {
  // Two reads, not a join: `inbox_items.property_id` is varchar while
  // `properties.id` is uuid, so PostgreSQL has no operator for the
  // column-to-column comparison. As a bound parameter the id casts cleanly.
  const rows = await db
    .select({
      propertyId: inboxItems.propertyId,
      rating: inboxItems.rating,
      sourceType: inboxItems.sourceType,
      sourceId: inboxItems.sourceId,
      assignedTo: inboxItems.assignedTo,
      createdAt: inboxItems.createdAt,
    })
    .from(inboxItems)
    .where(
      and(eq(inboxItems.organizationId, unbrand(orgId)), eq(inboxItems.id, unbrand(id))),
    )
    .limit(1)
  const row = rows[0]
  if (!row) return null

  const sourcePortalId =
    row.sourceType === 'feedback'
      ? await feedbackPortalLookup.findPortalId(orgId, feedbackId(row.sourceId))
      : null

  // A missing/deleted property may still yield a local Portal rating and the
  // age. A Google/provider rating never crosses this adapter boundary.
  const propertyRows = await db
    .select({ name: properties.name })
    .from(properties)
    .where(
      and(
        eq(properties.organizationId, unbrand(orgId)),
        eq(properties.id, row.propertyId),
      ),
    )
    .limit(1)

  return {
    propertyId: row.propertyId,
    portalId: sourcePortalId,
    assignedTo: row.assignedTo ? userId(row.assignedTo) : null,
    propertyName: propertyRows[0]?.name ?? null,
    guestRating: row.sourceType === 'feedback' ? (row.rating ?? null) : null,
    sourceType: row.sourceType,
    createdAt: row.createdAt,
  }
}

export const createInboxItemLookupAdapter = (
  db: Database,
  feedbackPortalLookup: FeedbackPortalLookupPort,
): InboxItemLookupPort => ({
  async findInboxItemByReviewId(
    reviewId: ReviewId,
    orgId: OrganizationId,
  ): Promise<InboxItemId | null> {
    const rows = await db
      .select({ id: inboxItems.id })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.organizationId, unbrand(orgId)),
          eq(inboxItems.sourceType, 'review'),
          eq(inboxItems.sourceId, unbrand(reviewId)),
        ),
      )
      .limit(1)
    return rows[0] ? inboxItemId(rows[0].id) : null
  },

  async findInboxItemFacts(
    id: InboxItemId,
    orgId: OrganizationId,
  ): Promise<InboxItemFacts | null> {
    return findInboxItemFacts(db, feedbackPortalLookup, id, orgId)
  },

  async findHandlingCycleNotificationFacts(
    id: InboxItemId,
    orgId: OrganizationId,
  ): Promise<HandlingCycleNotificationFacts | null> {
    const heads = await db
      .select({
        propertyId: inboxHandlingCycleHeads.propertyId,
        sourceType: inboxHandlingCycleHeads.sourceType,
        sourceId: inboxHandlingCycleHeads.sourceId,
        currentCycleNumber: inboxHandlingCycleHeads.currentCycleNumber,
        currentSourceRevision: inboxHandlingCycleHeads.currentSourceRevision,
        stateRevision: inboxHandlingCycleHeads.stateRevision,
        status: inboxHandlingCycleHeads.status,
      })
      .from(inboxHandlingCycleHeads)
      .where(
        and(
          eq(inboxHandlingCycleHeads.organizationId, unbrand(orgId)),
          eq(inboxHandlingCycleHeads.inboxItemId, unbrand(id)),
        ),
      )
      .limit(1)
    const head = heads[0]
    if (!head) return null
    const item = await findInboxItemFacts(db, feedbackPortalLookup, id, orgId)
    if (
      !item ||
      item.propertyId !== head.propertyId ||
      item.sourceType !== head.sourceType
    ) {
      return null
    }
    return {
      ...item,
      sourceId: head.sourceId,
      currentCycleNumber: head.currentCycleNumber,
      currentSourceRevision: head.currentSourceRevision,
      stateRevision: head.stateRevision,
      status: head.status,
    }
  },

  async findResponseTargetReminderNotificationFacts(
    input,
  ): Promise<ResponseTargetReminderNotificationFacts | null> {
    const rows = await db
      .select({
        propertyId: inboxHandlingCycleHeads.propertyId,
        sourceType: inboxHandlingCycleHeads.sourceType,
        sourceId: inboxHandlingCycleHeads.sourceId,
        currentCycleNumber: inboxHandlingCycleHeads.currentCycleNumber,
        currentSourceRevision: inboxHandlingCycleHeads.currentSourceRevision,
        stateRevision: inboxHandlingCycleHeads.stateRevision,
        status: inboxHandlingCycleHeads.status,
        targetKind: inboxHandlingCycleResponseTargets.targetKind,
        reminderKind: inboxResponseTargetReminders.reminderKind,
        scheduledFor: inboxResponseTargetReminders.scheduledFor,
      })
      .from(inboxResponseTargetReminders)
      .innerJoin(
        inboxHandlingCycleResponseTargets,
        and(
          eq(
            inboxHandlingCycleResponseTargets.inboxItemId,
            inboxResponseTargetReminders.inboxItemId,
          ),
          eq(
            inboxHandlingCycleResponseTargets.cycleNumber,
            inboxResponseTargetReminders.cycleNumber,
          ),
          eq(
            inboxHandlingCycleResponseTargets.targetKind,
            inboxResponseTargetReminders.targetKind,
          ),
          isNull(inboxHandlingCycleResponseTargets.completionAt),
          eq(inboxHandlingCycleResponseTargets.performanceEligibility, 'measured'),
        ),
      )
      .innerJoin(
        inboxHandlingCycleHeads,
        and(
          eq(
            inboxHandlingCycleHeads.inboxItemId,
            inboxResponseTargetReminders.inboxItemId,
          ),
          eq(
            inboxHandlingCycleHeads.currentCycleNumber,
            inboxResponseTargetReminders.cycleNumber,
          ),
          eq(inboxHandlingCycleHeads.status, 'open'),
        ),
      )
      .where(
        and(
          eq(inboxResponseTargetReminders.inboxItemId, input.inboxItemId),
          eq(inboxResponseTargetReminders.organizationId, input.organizationId),
          eq(inboxResponseTargetReminders.cycleNumber, input.cycleNumber),
          eq(inboxResponseTargetReminders.targetKind, input.targetKind),
          eq(inboxResponseTargetReminders.reminderKind, input.reminderKind),
          eq(inboxResponseTargetReminders.scheduledFor, input.scheduledFor),
          isNotNull(inboxResponseTargetReminders.deliveredAt),
          isNull(inboxResponseTargetReminders.cancelledAt),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (!row) return null
    const item = await findInboxItemFacts(
      db,
      feedbackPortalLookup,
      input.inboxItemId,
      input.organizationId,
    )
    if (
      !item ||
      item.propertyId !== row.propertyId ||
      item.sourceType !== row.sourceType ||
      row.targetKind !== input.targetKind ||
      row.reminderKind !== input.reminderKind
    ) {
      return null
    }
    return {
      ...item,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      currentCycleNumber: row.currentCycleNumber,
      currentSourceRevision: row.currentSourceRevision,
      stateRevision: row.stateRevision,
      status: row.status,
      targetKind: input.targetKind,
      reminderKind: input.reminderKind,
      scheduledFor: row.scheduledFor,
    }
  },
})
