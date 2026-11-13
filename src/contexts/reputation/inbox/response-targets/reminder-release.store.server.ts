import { and, asc, eq, isNull, lte, sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { notExcludedFromResponseTargetReporting } from '#/shared/db/inbox-response-target-exclusions'
import {
  inboxHandlingCycleHeads,
  inboxHandlingCycleResponseTargets,
  inboxResponseTargetReminders,
} from '#/shared/db/schema/inbox.schema'
import {
  inboxItemId,
  organizationId,
  propertyId,
  type InboxItemId,
} from '#/shared/domain/ids'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import type {
  DueReminderCandidate,
  ReminderSlotKey,
  ReminderSlotReleaseResult,
  ResponseTargetStore,
  ResponseTargetView,
} from '#/contexts/inbox/application/ports/response-target.store'
import { inboxError } from '#/contexts/inbox/domain/errors'
import { inboxResponseTargetReminderDue } from '#/contexts/inbox/domain/events'
import { isSupersededReminder } from '../../../inbox/domain/response-target'

type ReminderReleaseStore = Pick<
  ResponseTargetStore,
  'listDueReminderCandidates' | 'releaseReminderSlot'
>

const MAX_REMINDER_BATCH = 100

type DueSlotRow = Readonly<{
  reminder: typeof inboxResponseTargetReminders.$inferSelect
  target: Pick<
    typeof inboxHandlingCycleResponseTargets.$inferSelect,
    'startAt' | 'dueAt' | 'targetKind' | 'sourceId' | 'sourceRevision'
  >
}>

const assertBatchLimit = (limit: number): void => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_REMINDER_BATCH) {
    throw inboxError('invalid_input', 'Reminder batch limit must be 1–100')
  }
}

const reminderKindOf = (kind: string): ReminderSlotKey['reminderKind'] =>
  kind === 'halfway' ? 'halfway' : 'target_passed'

/**
 * The pending slots that are due: their target still measured and not
 * completed, their cycle still the open head's current one, and not left out of
 * reporting (an excluded cycle's clock measures nothing, so it prompts no one).
 * Oldest first.
 *
 * With `after`, only the slots strictly later than that one in this order are
 * taken. With `fair`, they are taken in turns across Organizations (each one's
 * oldest, then each one's next) instead of strictly oldest first.
 *
 * With `lock`, the target rows are taken FOR UPDATE SKIP LOCKED. The target is
 * locked before its reminder, matching completion and cancellation, so "still
 * active" and reminder release are one ordered decision: a concurrently
 * completed target cannot publish a later due fact.
 */
const selectDueSlots = (
  executor: Database | Tx,
  input: Readonly<{
    now: Date
    limit: number
    key?: ReminderSlotKey
    lock: boolean
    fair?: boolean
    after?: DueSlotRow['reminder']
  }>,
): Promise<ReadonlyArray<DueSlotRow>> => {
  const conditions: SQL[] = [
    lte(inboxResponseTargetReminders.scheduledFor, input.now),
    isNull(inboxResponseTargetReminders.deliveredAt),
    isNull(inboxResponseTargetReminders.cancelledAt),
    notExcludedFromResponseTargetReporting({
      inboxItemId: inboxResponseTargetReminders.inboxItemId,
      cycleNumber: inboxResponseTargetReminders.cycleNumber,
      organizationId: inboxResponseTargetReminders.organizationId,
    }),
  ]
  if (input.key) {
    conditions.push(
      eq(inboxResponseTargetReminders.inboxItemId, input.key.inboxItemId),
      eq(inboxResponseTargetReminders.cycleNumber, input.key.cycleNumber),
      eq(inboxResponseTargetReminders.reminderKind, input.key.reminderKind),
    )
  }
  if (input.after) {
    conditions.push(
      sql`(${inboxResponseTargetReminders.scheduledFor}, ${inboxResponseTargetReminders.inboxItemId}, ${inboxResponseTargetReminders.reminderKind}) > (${input.after.scheduledFor}, ${input.after.inboxItemId}, ${input.after.reminderKind})`,
    )
  }
  const query = executor
    .select({
      reminder: inboxResponseTargetReminders,
      target: {
        startAt: inboxHandlingCycleResponseTargets.startAt,
        dueAt: inboxHandlingCycleResponseTargets.dueAt,
        targetKind: inboxHandlingCycleResponseTargets.targetKind,
        sourceId: inboxHandlingCycleResponseTargets.sourceId,
        sourceRevision: inboxHandlingCycleResponseTargets.sourceRevision,
      },
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
        isNull(inboxHandlingCycleResponseTargets.completionAt),
        eq(inboxHandlingCycleResponseTargets.performanceEligibility, 'measured'),
      ),
    )
    .innerJoin(
      inboxHandlingCycleHeads,
      and(
        eq(inboxHandlingCycleHeads.inboxItemId, inboxResponseTargetReminders.inboxItemId),
        eq(
          inboxHandlingCycleHeads.currentCycleNumber,
          inboxResponseTargetReminders.cycleNumber,
        ),
        eq(inboxHandlingCycleHeads.status, 'open'),
      ),
    )
    .where(and(...conditions))
    .orderBy(
      ...(input.fair
        ? [
            sql`row_number() over (
              partition by ${inboxResponseTargetReminders.organizationId}
              order by ${inboxResponseTargetReminders.scheduledFor},
                ${inboxResponseTargetReminders.inboxItemId},
                ${inboxResponseTargetReminders.reminderKind}
            )`,
          ]
        : []),
      asc(inboxResponseTargetReminders.scheduledFor),
      asc(inboxResponseTargetReminders.inboxItemId),
      asc(inboxResponseTargetReminders.reminderKind),
    )
    .limit(input.limit)
  return input.lock
    ? query.for('update', { of: inboxHandlingCycleResponseTargets, skipLocked: true })
    : query
}

/**
 * Deliver (or, for a superseded halfway, cancel) one slot whose target is
 * locked by the caller. The one-shot guard keeps a slot from ever being used
 * twice, and the fact is queued in the same transaction.
 */
const settleLockedSlot = async (
  tx: Tx,
  { reminder, target }: DueSlotRow,
  now: Date,
): Promise<ReminderSlotReleaseResult> => {
  const reminderKind = reminderKindOf(reminder.reminderKind)
  // A halfway slot still pending once its target has passed closes without a
  // fact, so a late release prompts once, not twice.
  const superseded =
    target.dueAt !== null && isSupersededReminder(reminderKind, target.dueAt, now)
  const [saved] = await tx
    .update(inboxResponseTargetReminders)
    .set(
      superseded
        ? { cancelledAt: now, updatedAt: now }
        : { deliveredAt: now, updatedAt: now },
    )
    .where(
      and(
        eq(inboxResponseTargetReminders.inboxItemId, reminder.inboxItemId),
        eq(inboxResponseTargetReminders.cycleNumber, reminder.cycleNumber),
        eq(inboxResponseTargetReminders.reminderKind, reminder.reminderKind),
        isNull(inboxResponseTargetReminders.deliveredAt),
        isNull(inboxResponseTargetReminders.cancelledAt),
      ),
    )
    .returning({ eventId: inboxResponseTargetReminders.eventId })
  if (!saved) return 'skipped'
  if (superseded) return 'cancelled_superseded'
  const fact = inboxResponseTargetReminderDue({
    inboxItemId: inboxItemId(reminder.inboxItemId),
    cycleNumber: reminder.cycleNumber,
    organizationId: organizationId(reminder.organizationId),
    propertyId: propertyId(reminder.propertyId),
    targetKind: reminder.targetKind as ResponseTargetView['targetKind'],
    reminderKind,
    scheduledFor: reminder.scheduledFor,
    occurredAt: now,
  })
  await insertOutboxRow(tx, fact, { recordedAt: now })
  return 'released'
}

const toCandidate = ({ reminder, target }: DueSlotRow): DueReminderCandidate => ({
  key: {
    inboxItemId: inboxItemId(reminder.inboxItemId) as InboxItemId,
    cycleNumber: reminder.cycleNumber,
    reminderKind: reminderKindOf(reminder.reminderKind),
  },
  organizationId: organizationId(reminder.organizationId),
  propertyId: propertyId(reminder.propertyId),
  targetKind: target.targetKind as DueReminderCandidate['targetKind'],
  scheduledFor: reminder.scheduledFor,
  targetStartAt: target.startAt,
  targetDueAt: target.dueAt,
  sourceId: target.sourceId,
  sourceRevision: target.sourceRevision,
})

/**
 * Reminder release: the two steps the Google pre-check needs, between which no
 * lock or transaction is held.
 */
export const createReminderReleaseStore = (db: Database): ReminderReleaseStore => ({
  listDueReminderCandidates: async ({ now, limit, extra = 0 }) =>
    trace('inbox.responseTarget.listDueReminderCandidates', async () => {
      assertBatchLimit(limit)
      // The oldest `limit` slots come first and in their usual order, so no
      // slot is ever reached later than it was. When they fill the batch, slots
      // one Organization keeps pending could hide every other Organization's,
      // so up to `extra` more follow in turns across Organizations; they come
      // after the oldest, so they only use what the tick has left over.
      const oldest = await selectDueSlots(db, { now, limit, lock: false })
      const last = oldest.at(-1)
      const rest =
        extra < 1 || oldest.length < limit || !last
          ? []
          : await selectDueSlots(db, {
              now,
              limit: extra,
              lock: false,
              fair: true,
              after: last.reminder,
            })
      return [...oldest, ...rest].map(toCandidate)
    }),

  releaseReminderSlot: async ({ key, now }) =>
    trace('inbox.responseTarget.releaseReminderSlot', () =>
      db.transaction(async (tx) => {
        const [row] = await selectDueSlots(tx, { now, limit: 1, key, lock: true })
        return row ? settleLockedSlot(tx, row, now) : 'skipped'
      }),
    ),
})
