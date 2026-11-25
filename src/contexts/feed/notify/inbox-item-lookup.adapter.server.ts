// Database adapter for the InboxItemLookupPort (ADR 0022).
// Resolves a review to its inbox item and reads the content-free render facts
// (ADR 0046 r.8) the events do not carry. The Inbox's own rows come through
// Reputation's named lookup; this adapter adds the Portal attribution and the
// Property facts, which mirror notification-property-scope-repository.server.ts, the
// other reader of `properties` in this context.
import type { Database } from '#/shared/db'
import { and, eq } from 'drizzle-orm'
import { createInboxNotificationLookup } from '#/contexts/reputation/public-api'
import { properties } from '#/shared/db/schema/property.schema'
import {
  feedbackId,
  propertyId,
  unbrand,
  type InboxItemId,
  type OrganizationId,
} from '#/shared/domain/ids'
import type {
  HandlingCycleNotificationFacts,
  InboxItemFacts,
  InboxItemLookupPort,
  ResponseTargetReminderNotificationFacts,
} from './inbox-item-lookup.port.server'
import type { FeedbackPortalLookupPort } from './cross-context-lookups.port.server'
import { createActivePropertyLookup } from './active-property.server'

export const createInboxItemLookupAdapter = (
  db: Database,
  feedbackPortalLookup: FeedbackPortalLookupPort,
): InboxItemLookupPort => {
  const inbox = createInboxNotificationLookup(db)

  const findInboxItemFacts = async (
    id: InboxItemId,
    orgId: OrganizationId,
  ): Promise<InboxItemFacts | null> => {
    const row = await inbox.findItem(id, orgId)
    if (!row) return null

    const sourcePortalId =
      row.sourceType === 'feedback'
        ? await feedbackPortalLookup.findPortalId(orgId, feedbackId(row.sourceId))
        : null

    // A missing/deleted property may still yield a local Portal rating and the
    // age. A Google/provider rating never crosses this adapter boundary.
    // `inbox_items.property_id` is varchar while `properties.id` is uuid, so
    // the id is read as a bound parameter.
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
      assignedTo: row.assignedTo,
      propertyName: propertyRows[0]?.name ?? null,
      guestRating: row.sourceType === 'feedback' ? (row.rating ?? null) : null,
      sourceType: row.sourceType,
      createdAt: row.createdAt,
    }
  }

  const isActiveProperty = createActivePropertyLookup(db)

  return {
    findInboxItemByReviewId: (reviewId, orgId) =>
      inbox.findItemByReviewId(reviewId, orgId),

    findInboxItemFacts,

    isHistoricalOnboardingItem: (id, orgId) =>
      inbox.isHistoricalOnboardingItem(id, orgId),

    async findHandlingCycleNotificationFacts(
      id,
      orgId,
    ): Promise<HandlingCycleNotificationFacts | null> {
      const head = await inbox.findHandlingCycleHead(id, orgId)
      if (!head) return null
      const item = await findInboxItemFacts(id, orgId)
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

    findWaitingSince: (id, orgId) => inbox.findWaitingSince(id, orgId),

    findNoteAuthors: (id, orgId) => inbox.findNoteAuthors(id, orgId),

    countOpenReviewItemsForProperty: (property, orgId) =>
      inbox.countOpenReviewItemsForProperty(property, orgId),

    hasPendingReviewProjections: (property, orgId, recordedAt) =>
      inbox.hasPendingReviewProjections(property, orgId, recordedAt),

    async findResponseTargetReminderNotificationFacts(
      input,
    ): Promise<ResponseTargetReminderNotificationFacts | null> {
      const row = await inbox.findResponseTargetReminder(input)
      if (!row) return null
      // A reminder released before Inbox cancelled its slots is obsolete, both
      // at fan-out and when the queued notification is materialized.
      // A Property outside the workspace has no work to prompt.
      if (
        !(await isActiveProperty(
          input.organizationId,
          propertyId(row.reminderPropertyId),
        ))
      ) {
        return null
      }
      const item = await findInboxItemFacts(input.inboxItemId, input.organizationId)
      // A measured target always has a due instant; the column is nullable only
      // because an excluded cycle records eligibility without one, and this
      // query admits measured, uncompleted targets only.
      if (
        !item ||
        item.propertyId !== row.propertyId ||
        item.sourceType !== row.sourceType ||
        row.targetKind !== input.targetKind ||
        row.reminderKind !== input.reminderKind ||
        row.dueAt === null
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
        dueAt: row.dueAt,
      }
    },
  }
}
