// The Inbox facts other contexts read to decide who is told about an item:
// the item, its current Handling Cycle and Response Target, its note authors,
// and whether the review facts feeding its open count have been applied. They
// are content-free: identifiers, ratings a guest gave, revisions and instants.
import type { Database } from '#/shared/db'
import { and, count, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'
import { notExcludedFromResponseTargetReporting } from '#/shared/db/inbox-response-target-exclusions'
import {
  inboxHandlingCycleHeads,
  inboxHandlingCycleResponseTargets,
  inboxItems,
  inboxNotes,
  inboxResponseTargetReminders,
} from '#/shared/db/schema/inbox.schema'
import { eventConsumerReceipts, outboxEvents } from '#/shared/db/schema/outbox.schema'
import {
  inboxItemId,
  userId,
  unbrand,
  type InboxItemId,
  type OrganizationId,
  type ReviewId,
  type UserId,
} from '#/shared/domain/ids'
import { historicalOnboardingItem } from './historical-onboarding-item.server'

/** Current ownership protects reassignment even after its outbox fact expires. */
export const isCurrentInboxAssignee = (
  organizationId: SQL,
  itemId: SQL,
  assigneeId: SQL,
  afterCommandRevision: SQL,
): SQL => sql`EXISTS (
  SELECT 1 FROM ${inboxItems}
  WHERE ${inboxItems.organizationId} = ${organizationId}
    AND ${inboxItems.id}::text = ${itemId}
    AND ${inboxItems.assignedTo} = ${assigneeId}
    AND (${afterCommandRevision} IS NULL OR ${inboxItems.commandRevision} > ${afterCommandRevision})
)`

export type InboxItemRow = Readonly<{
  propertyId: string
  rating: number | null
  sourceType: string
  sourceId: string
  assignedTo: UserId | null
  createdAt: Date
}>

export type InboxHandlingCycleHead = Readonly<{
  propertyId: string
  sourceType: 'review' | 'feedback'
  sourceId: string
  currentCycleNumber: number
  currentSourceRevision: number
  stateRevision: number
  status: 'open' | 'closed'
}>

export type InboxResponseTargetReminderLookup = Readonly<{
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  cycleNumber: number
  targetKind: 'google_review_response' | 'private_feedback_handling'
  reminderKind: 'halfway' | 'target_passed'
  scheduledFor: Date
}>

export type InboxResponseTargetReminderRow = InboxHandlingCycleHead &
  Readonly<{
    reminderPropertyId: string
    targetKind: string
    reminderKind: string
    scheduledFor: Date
    dueAt: Date | null
  }>

export type InboxNotificationLookup = Readonly<{
  findItemByReviewId(
    reviewId: ReviewId,
    orgId: OrganizationId,
  ): Promise<InboxItemId | null>
  findItem(id: InboxItemId, orgId: OrganizationId): Promise<InboxItemRow | null>
  isHistoricalOnboardingItem(id: InboxItemId, orgId: OrganizationId): Promise<boolean>
  findHandlingCycleHead(
    id: InboxItemId,
    orgId: OrganizationId,
  ): Promise<InboxHandlingCycleHead | null>
  findWaitingSince(id: InboxItemId, orgId: OrganizationId): Promise<Date | null>
  findNoteAuthors(id: InboxItemId, orgId: OrganizationId): Promise<ReadonlyArray<UserId>>
  countOpenReviewItemsForProperty(
    property: string,
    orgId: OrganizationId,
  ): Promise<number>
  hasPendingReviewProjections(
    property: string,
    orgId: OrganizationId,
    recordedAt: Date,
  ): Promise<boolean>
  findResponseTargetReminder(
    input: InboxResponseTargetReminderLookup,
  ): Promise<InboxResponseTargetReminderRow | null>
}>

// The review facts that move an Inbox item's open count, and the Inbox
// consumers that apply them (inbox/infrastructure/outbox-consumers.ts).
const REVIEW_PROJECTION_EVENT_TYPES = [
  'review.created',
  'review.updated',
  'review.reply.observed',
]
const REVIEW_PROJECTION_CONSUMERS = [
  'inbox.on-review-created',
  'inbox.on-review-updated',
  'inbox.on-reply-observed',
]
const inList = (values: ReadonlyArray<string>) =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )

const findItem = async (
  db: Database,
  id: InboxItemId,
  orgId: OrganizationId,
): Promise<InboxItemRow | null> => {
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
  return { ...row, assignedTo: row.assignedTo ? userId(row.assignedTo) : null }
}

/**
 * An open item's current cycle waits from the start of its measured Response
 * Target until the target completes. The target, not the item, is the clock:
 * a later cycle restarts it (ADR 0055).
 */
const findWaitingSince = async (
  db: Database,
  id: InboxItemId,
  orgId: OrganizationId,
): Promise<Date | null> => {
  const rows = await db
    .select({ startAt: inboxHandlingCycleResponseTargets.startAt })
    .from(inboxHandlingCycleHeads)
    .innerJoin(
      inboxHandlingCycleResponseTargets,
      and(
        eq(
          inboxHandlingCycleResponseTargets.inboxItemId,
          inboxHandlingCycleHeads.inboxItemId,
        ),
        eq(
          inboxHandlingCycleResponseTargets.cycleNumber,
          inboxHandlingCycleHeads.currentCycleNumber,
        ),
        eq(inboxHandlingCycleResponseTargets.performanceEligibility, 'measured'),
        isNull(inboxHandlingCycleResponseTargets.completionAt),
        // A cycle left out of reporting measures no waiting time.
        notExcludedFromResponseTargetReporting({
          inboxItemId: inboxHandlingCycleResponseTargets.inboxItemId,
          cycleNumber: inboxHandlingCycleResponseTargets.cycleNumber,
          organizationId: inboxHandlingCycleResponseTargets.organizationId,
        }),
      ),
    )
    .where(
      and(
        eq(inboxHandlingCycleHeads.organizationId, unbrand(orgId)),
        eq(inboxHandlingCycleHeads.inboxItemId, unbrand(id)),
        eq(inboxHandlingCycleHeads.status, 'open'),
      ),
    )
    .limit(1)
  return rows[0]?.startAt ?? null
}

/** Who has already written on this item. Identifiers only; never the text. */
const findNoteAuthors = async (db: Database, id: InboxItemId, orgId: OrganizationId) => {
  const rows = await db
    .selectDistinct({ authorId: inboxNotes.userId })
    .from(inboxNotes)
    .where(
      and(
        eq(inboxNotes.organizationId, unbrand(orgId)),
        eq(inboxNotes.inboxItemId, unbrand(id)),
      ),
    )
  return rows.map((row) => userId(row.authorId))
}

export const createInboxNotificationLookup = (db: Database): InboxNotificationLookup => ({
  async findItemByReviewId(reviewId, orgId) {
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

  findItem: (id, orgId) => findItem(db, id, orgId),

  async isHistoricalOnboardingItem(id, orgId) {
    const rows = await db
      .select({ historical: historicalOnboardingItem })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.organizationId, unbrand(orgId)),
          eq(inboxItems.id, unbrand(id)),
        ),
      )
      .limit(1)
    return rows[0]?.historical === true
  },

  async findHandlingCycleHead(id, orgId) {
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
    return heads[0] ?? null
  },

  findWaitingSince: (id, orgId) => findWaitingSince(db, id, orgId),

  findNoteAuthors: (id, orgId) => findNoteAuthors(db, id, orgId),

  async countOpenReviewItemsForProperty(property, orgId) {
    // The Handling Cycle head is the Inbox's own answer to "is this still
    // open": it closes when the reply is live. Counting targets instead would
    // have to choose a performance eligibility, and imported history is
    // exactly the eligibility that choice excludes.
    const rows = await db
      .select({ open: count() })
      .from(inboxHandlingCycleHeads)
      .where(
        and(
          eq(inboxHandlingCycleHeads.organizationId, unbrand(orgId)),
          eq(inboxHandlingCycleHeads.propertyId, property),
          eq(inboxHandlingCycleHeads.sourceType, 'review'),
          eq(inboxHandlingCycleHeads.status, 'open'),
        ),
      )
    return rows[0]?.open ?? 0
  },

  async hasPendingReviewProjections(property, orgId, recordedAt) {
    // A fact is settled once the Inbox consumer wrote its receipt, whether it
    // applied it or judged it obsolete. Only the last hour is read: dispatch
    // retries end well inside it, so an older fact without a receipt is stuck
    // rather than in flight, and the bound keeps the org/created_at index
    // from walking the Organization's whole history.
    const at = recordedAt.toISOString()
    const pending = await db.execute<{ pending: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1
          FROM ${outboxEvents} AS fact
         WHERE fact.organization_id = ${unbrand(orgId)}
           AND fact.created_at <= ${at}::timestamptz
           AND fact.created_at > ${at}::timestamptz - interval '1 hour'
           AND fact.property_id = ${property}
           AND fact.event_type IN (${inList(REVIEW_PROJECTION_EVENT_TYPES)})
           AND NOT EXISTS (
             SELECT 1
               FROM ${eventConsumerReceipts} AS receipt
              WHERE receipt.event_id = fact.id
                AND receipt.consumer_name IN (${inList(REVIEW_PROJECTION_CONSUMERS)})
           )
      ) AS pending
    `)
    return pending.rows[0]?.pending === true
  },

  async findResponseTargetReminder(input) {
    const rows = await db
      .select({
        propertyId: inboxHandlingCycleHeads.propertyId,
        reminderPropertyId: inboxResponseTargetReminders.propertyId,
        sourceType: inboxHandlingCycleHeads.sourceType,
        sourceId: inboxHandlingCycleHeads.sourceId,
        currentCycleNumber: inboxHandlingCycleHeads.currentCycleNumber,
        currentSourceRevision: inboxHandlingCycleHeads.currentSourceRevision,
        stateRevision: inboxHandlingCycleHeads.stateRevision,
        status: inboxHandlingCycleHeads.status,
        targetKind: inboxHandlingCycleResponseTargets.targetKind,
        reminderKind: inboxResponseTargetReminders.reminderKind,
        scheduledFor: inboxResponseTargetReminders.scheduledFor,
        dueAt: inboxHandlingCycleResponseTargets.dueAt,
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
          // A reminder released before its cycle was left out of reporting is
          // obsolete, at fan-out and when the queued notification is built.
          notExcludedFromResponseTargetReporting({
            inboxItemId: inboxHandlingCycleResponseTargets.inboxItemId,
            cycleNumber: inboxHandlingCycleResponseTargets.cycleNumber,
            organizationId: inboxHandlingCycleResponseTargets.organizationId,
          }),
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
    return rows[0] ?? null
  },
})
