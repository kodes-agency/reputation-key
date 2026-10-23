import { and, asc, eq, isNull, lte, type SQL } from 'drizzle-orm'
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
} from '../application/ports/response-target.store'
import { inboxError } from '../domain/errors'
import { inboxResponseTargetReminderDue } from '../domain/events'
import { isSupersededReminder } from '../domain/response-target'

type ReminderReleaseStore = Pick<
  ResponseTargetStore,
  'releaseDueReminders' | 'listDueReminderCandidates' | 'releaseReminderSlot'
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
 * With `lock`, the target rows are taken FOR UPDATE SKIP LOCKED. The target is
 * locked before its reminder, matching completion and cancellation, so "still
 * active" and reminder release are one ordered decision: a concurrently
 * completed target cannot publish a later due fact.
 */
const selectDueSlots = (
  executor: Database | Tx,
  input: Readonly<{ now: Date; limit: number; key?: ReminderSlotKey; lock: boolean }>,
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
 * Reminder release: the unconditional one-transaction pass, and the two steps
 * the Google pre-check needs between which no lock or transaction is held.
 */
export const createReminderReleaseStore = (db: Database): ReminderReleaseStore => ({
  releaseDueReminders: async ({ now, limit }) =>
    trace('inbox.responseTarget.releaseDueReminders', async () => {
      assertBatchLimit(limit)
      const released = await db.transaction(async (tx) => {
        const due = await selectDueSlots(tx, { now, limit, lock: true })
        let count = 0
        for (const row of due) {
          if ((await settleLockedSlot(tx, row, now)) === 'released') count += 1
        }
        return count
      })
      return { released }
    }),

  listDueReminderCandidates: async ({ now, limit }) =>
    trace('inbox.responseTarget.listDueReminderCandidates', async () => {
      assertBatchLimit(limit)
      const due = await selectDueSlots(db, { now, limit, lock: false })
      return due.map(toCandidate)
    }),

  releaseReminderSlot: async ({ key, now }) =>
    trace('inbox.responseTarget.releaseReminderSlot', () =>
      db.transaction(async (tx) => {
        const [row] = await selectDueSlots(tx, { now, limit: 1, key, lock: true })
        return row ? settleLockedSlot(tx, row, now) : 'skipped'
      }),
    ),
})
