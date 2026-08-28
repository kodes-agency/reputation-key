import { and, asc, desc, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  inboxFeedbackHandlingOutcomes,
  inboxHandlingCycleHeads,
  inboxHandlingCycleTransitions,
  inboxItems,
} from '#/shared/db/schema/inbox.schema'
import type { EventBus } from '#/shared/events/event-bus'
import { emitAfterCommit, insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type {
  FeedbackHandlingCommandResult,
  FeedbackHandlingExpectation,
  FeedbackHandlingState,
  FeedbackHandlingStore,
} from '../application/ports/feedback-handling.store'
import {
  correctFeedbackHandlingOutcome,
  recordFeedbackHandlingOutcome,
  type FeedbackHandlingOutcomeFact,
} from '../domain/feedback-handling'
import { closeHandlingCycle } from '../domain/handling-cycles'
import { inboxError } from '../domain/errors'
import { inboxHandlingCycleClosed, inboxItemStatusChanged } from '../domain/events'
import type { HandlingCycleHead, InboxItem } from '../domain/types'
import type { InboxCommandAuthority } from './inbox-command-store'
import {
  selectCycleCloseReason,
  type TransitionReader,
} from './handling-cycle-transitions.read'
import { inboxItemFromRow } from './mappers/inbox.mapper'
import { transitionInsert } from './review-handling-cycle.store'
import { completePrivateFeedbackTarget } from './response-target.store'

type OutcomeRow = typeof inboxFeedbackHandlingOutcomes.$inferSelect
type HeadRow = typeof inboxHandlingCycleHeads.$inferSelect
type ItemRow = typeof inboxItems.$inferSelect

const outcomeFromRow = (row: OutcomeRow): FeedbackHandlingOutcomeFact => ({
  id: row.id,
  inboxItemId: inboxItemId(row.inboxItemId),
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  feedbackId: feedbackId(row.feedbackId),
  cycleNumber: row.cycleNumber,
  sourceRevision: row.sourceRevision,
  outcomeRevision: row.outcomeRevision,
  outcome: row.outcome as FeedbackHandlingOutcomeFact['outcome'],
  internalNote: row.internalNote,
  recordedBy: userId(row.recordedBy),
  recordedAt: row.recordedAt,
  completionAt: row.completionAt,
  deadlineResult: row.deadlineResult as FeedbackHandlingOutcomeFact['deadlineResult'],
  supersedesOutcomeId: row.supersedesOutcomeId,
})

const headFromRow = (row: HeadRow): HandlingCycleHead => ({
  inboxItemId: inboxItemId(row.inboxItemId),
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  sourceType: row.sourceType,
  sourceId: feedbackId(row.sourceId),
  currentCycleNumber: row.currentCycleNumber,
  currentSourceRevision: row.currentSourceRevision,
  stateRevision: row.stateRevision,
  status: row.status,
})

const itemFromRow = (row: ItemRow, snapshot: InboxItem): InboxItem => ({
  ...inboxItemFromRow(row),
  rating: snapshot.rating,
  snippet: snapshot.snippet,
  reviewerName: snapshot.reviewerName,
  propertyName: snapshot.propertyName,
  contentAvailability: snapshot.contentAvailability,
  reviewLanguageCode: snapshot.reviewLanguageCode,
  attention: snapshot.attention,
})

const toState = (
  head: HandlingCycleHead,
  history: ReadonlyArray<FeedbackHandlingOutcomeFact>,
  closeReason: FeedbackHandlingState['closeReason'],
): FeedbackHandlingState => ({
  cycleNumber: head.currentCycleNumber,
  sourceRevision: head.currentSourceRevision,
  stateRevision: head.stateRevision,
  status: head.status,
  closeReason,
  currentOutcome: history.at(-1) ?? null,
  history,
})

/**
 * IBX-01-T5: the transitions log has exactly one reader
 * (`handling-cycle-transitions.read.ts`), shared with the Handling History read
 * model, so both agree on `state_revision` as the ordering key.
 */
async function closeReasonFor(
  tx: TransitionReader,
  inboxItemIdValue: string,
  cycleNumber: number,
): Promise<FeedbackHandlingState['closeReason']> {
  const reason = await selectCycleCloseReason(tx, inboxItemIdValue, cycleNumber)
  return (reason as FeedbackHandlingState['closeReason']) ?? null
}

const matchesExpected = (
  item: ItemRow,
  head: HeadRow,
  expected: FeedbackHandlingExpectation,
): boolean =>
  item.commandRevision === expected.commandRevision &&
  head.currentCycleNumber === expected.cycleNumber &&
  head.currentSourceRevision === expected.sourceRevision &&
  head.stateRevision === expected.stateRevision &&
  item.status === head.status

const conflict = (item: ItemRow, head: HeadRow) =>
  inboxError('revision_conflict', 'Private-feedback handling changed; reload', {
    currentCommandRevision: item.commandRevision,
    currentCycleNumber: head.currentCycleNumber,
    currentSourceRevision: head.currentSourceRevision,
    currentStateRevision: head.stateRevision,
    currentStatus: head.status,
  })

async function lockCurrent(
  tx: Tx,
  item: InboxItem,
): Promise<Readonly<{ item: ItemRow; head: HeadRow }>> {
  const [head] = await tx
    .select()
    .from(inboxHandlingCycleHeads)
    .where(
      and(
        eq(inboxHandlingCycleHeads.inboxItemId, item.id),
        eq(inboxHandlingCycleHeads.organizationId, item.organizationId),
        eq(inboxHandlingCycleHeads.sourceType, 'feedback'),
        eq(inboxHandlingCycleHeads.sourceId, item.sourceId),
      ),
    )
    .for('update')
    .limit(1)
  const [currentItem] = await tx
    .select()
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.id, item.id),
        eq(inboxItems.organizationId, item.organizationId),
        eq(inboxItems.sourceType, 'feedback'),
        eq(inboxItems.sourceId, item.sourceId),
      ),
    )
    .for('update')
    .limit(1)
  if (!head || !currentItem) {
    throw inboxError('not_found', 'Private-feedback Handling Cycle not found')
  }
  if (head.propertyId !== currentItem.propertyId) {
    throw inboxError('revision_conflict', 'Private-feedback cycle scope changed')
  }
  return { item: currentItem, head }
}

async function assertCurrentAuthority(
  tx: Tx,
  authorize: InboxCommandAuthority,
  command: Readonly<{ item: ItemRow; actorUserId: string; recordedAt: Date }>,
): Promise<void> {
  const decision = await authorize(tx, {
    organizationId: command.item.organizationId,
    at: command.recordedAt,
    requirements: [
      {
        propertyId: command.item.propertyId,
        userId: command.actorUserId,
        permissions: ['inbox.write', 'feedback.handle'],
        purpose: 'actor',
      },
    ],
  })
  if (!decision.allowed) {
    throw inboxError('forbidden', 'Private-feedback handling authority changed', {
      authorityReason: decision.reason,
    })
  }
}

async function historyFor(
  tx: Pick<Database, 'select'> | Tx,
  inboxItemIdValue: string,
  cycleNumber: number,
): Promise<FeedbackHandlingOutcomeFact[]> {
  const rows = await tx
    .select()
    .from(inboxFeedbackHandlingOutcomes)
    .where(
      and(
        eq(inboxFeedbackHandlingOutcomes.inboxItemId, inboxItemIdValue),
        eq(inboxFeedbackHandlingOutcomes.cycleNumber, cycleNumber),
      ),
    )
    .orderBy(asc(inboxFeedbackHandlingOutcomes.outcomeRevision))
  return rows.map(outcomeFromRow)
}

const outcomeInsert = (
  fact: FeedbackHandlingOutcomeFact,
  completionStateRevision: number,
  resultingCommandRevision: number,
) => ({
  id: fact.id,
  inboxItemId: fact.inboxItemId,
  cycleNumber: fact.cycleNumber,
  outcomeRevision: fact.outcomeRevision,
  organizationId: fact.organizationId,
  propertyId: fact.propertyId,
  sourceType: 'feedback' as const,
  feedbackId: fact.feedbackId,
  sourceRevision: fact.sourceRevision,
  outcome: fact.outcome,
  internalNote: fact.internalNote,
  recordedBy: fact.recordedBy,
  recordedAt: fact.recordedAt,
  completionAt: fact.completionAt,
  completionStateRevision,
  deadlineResult: fact.deadlineResult,
  resultingCommandRevision,
  supersedesOutcomeId: fact.supersedesOutcomeId,
  supersedesOutcomeRevision: fact.outcomeRevision === 1 ? null : fact.outcomeRevision - 1,
  createdAt: fact.recordedAt,
})

export const createFeedbackHandlingStore = (
  db: Database,
  events: EventBus,
  authorize: InboxCommandAuthority,
): FeedbackHandlingStore => {
  return {
    getState: async (itemId, orgId) =>
      trace('inbox.feedbackHandling.getState', async () => {
        const [row] = await db
          .select()
          .from(inboxHandlingCycleHeads)
          .where(
            and(
              eq(inboxHandlingCycleHeads.inboxItemId, itemId),
              eq(inboxHandlingCycleHeads.organizationId, orgId),
              eq(inboxHandlingCycleHeads.sourceType, 'feedback'),
            ),
          )
          .limit(1)
        if (!row) return null
        const head = headFromRow(row)
        return toState(
          head,
          await historyFor(db, itemId, head.currentCycleNumber),
          await closeReasonFor(db, itemId, head.currentCycleNumber),
        )
      }),

    markHandled: async (command): Promise<FeedbackHandlingCommandResult> =>
      trace('inbox.feedbackHandling.markHandled', async () => {
        const committed = await db.transaction(async (tx) => {
          const locked = await lockCurrent(tx, command.item)
          if (!matchesExpected(locked.item, locked.head, command.expected)) {
            throw conflict(locked.item, locked.head)
          }
          if (
            locked.item.status !== 'open' ||
            locked.head.status !== 'open' ||
            (await historyFor(tx, locked.item.id, locked.head.currentCycleNumber))
              .length > 0
          ) {
            throw conflict(locked.item, locked.head)
          }
          await assertCurrentAuthority(tx, authorize, {
            item: locked.item,
            actorUserId: command.actorUserId,
            recordedAt: command.recordedAt,
          })
          const current = headFromRow(locked.head)
          const deadlineResult = await completePrivateFeedbackTarget(
            tx,
            current,
            command.recordedAt,
          )
          const outcome = recordFeedbackHandlingOutcome({
            id: command.outcomeId,
            current,
            outcome: command.outcome,
            internalNote: command.internalNote,
            recordedBy: command.actorUserId,
            recordedAt: command.recordedAt,
            deadlineResult,
          })
          if (outcome.isErr()) throw outcome.error
          const closed = closeHandlingCycle({
            current,
            closeReason: 'private_feedback_handled',
            actorType: 'user',
            actorUserId: command.actorUserId,
            triggerEventId: outcome.value.id,
            closedAt: command.recordedAt,
          })
          if (closed.isErr()) throw closed.error
          const nextCommandRevision = locked.item.commandRevision + 1
          const statusFact = inboxItemStatusChanged({
            inboxItemId: command.item.id,
            organizationId: command.item.organizationId,
            propertyId: command.item.propertyId,
            oldStatus: 'open',
            newStatus: 'closed',
            userId: command.actorUserId,
            source: 'web',
            occurredAt: command.recordedAt,
          })
          const transition = closed.value.transition
          const cycleFact = inboxHandlingCycleClosed({
            inboxItemId: transition.inboxItemId,
            cycleNumber: transition.cycleNumber,
            stateRevision: transition.stateRevision,
            organizationId: transition.organizationId,
            propertyId: transition.propertyId,
            sourceType: transition.sourceType,
            sourceId: transition.sourceId,
            sourceRevision: transition.sourceRevision,
            closeReason: 'private_feedback_handled',
            actorType: 'user',
            userId: command.actorUserId,
            triggerEventId: outcome.value.id,
            source: 'web',
            occurredAt: command.recordedAt,
          })
          await tx
            .insert(inboxHandlingCycleTransitions)
            .values(transitionInsert(transition, command.recordedAt))
          const [savedHead] = await tx
            .update(inboxHandlingCycleHeads)
            .set({
              stateRevision: closed.value.head.stateRevision,
              status: 'closed',
              updatedAt: command.recordedAt,
            })
            .where(
              and(
                eq(inboxHandlingCycleHeads.inboxItemId, locked.head.inboxItemId),
                eq(inboxHandlingCycleHeads.stateRevision, locked.head.stateRevision),
                eq(inboxHandlingCycleHeads.status, 'open'),
              ),
            )
            .returning()
          const [savedItem] = await tx
            .update(inboxItems)
            .set({
              status: 'closed',
              closedAt: command.recordedAt,
              commandRevision: nextCommandRevision,
              updatedAt: command.recordedAt,
            })
            .where(
              and(
                eq(inboxItems.id, locked.item.id),
                eq(inboxItems.organizationId, locked.item.organizationId),
                eq(inboxItems.commandRevision, locked.item.commandRevision),
                eq(inboxItems.status, 'open'),
              ),
            )
            .returning()
          if (!savedHead || !savedItem) throw conflict(locked.item, locked.head)
          await tx
            .insert(inboxFeedbackHandlingOutcomes)
            .values(
              outcomeInsert(
                outcome.value,
                closed.value.head.stateRevision,
                nextCommandRevision,
              ),
            )
          await insertOutboxRow(tx, statusFact)
          await insertOutboxRow(tx, cycleFact)
          return {
            item: itemFromRow(savedItem, command.item),
            feedbackHandling: toState(
              closed.value.head,
              [outcome.value],
              'private_feedback_handled',
            ),
            facts: [statusFact, cycleFact] as const,
          }
        })
        for (const fact of committed.facts) await emitAfterCommit(events, fact)
        return committed
      }),

    correctOutcome: async (command): Promise<FeedbackHandlingCommandResult> =>
      trace('inbox.feedbackHandling.correctOutcome', async () => {
        return db.transaction(async (tx) => {
          const locked = await lockCurrent(tx, command.item)
          if (!matchesExpected(locked.item, locked.head, command.expected)) {
            throw conflict(locked.item, locked.head)
          }
          const [latestRow] = await tx
            .select()
            .from(inboxFeedbackHandlingOutcomes)
            .where(
              and(
                eq(inboxFeedbackHandlingOutcomes.inboxItemId, locked.item.id),
                eq(
                  inboxFeedbackHandlingOutcomes.cycleNumber,
                  locked.head.currentCycleNumber,
                ),
              ),
            )
            .orderBy(desc(inboxFeedbackHandlingOutcomes.outcomeRevision))
            .limit(1)
          if (
            locked.item.status !== 'closed' ||
            locked.head.status !== 'closed' ||
            !latestRow ||
            latestRow.id !== command.expected.outcomeId ||
            latestRow.outcomeRevision !== command.expected.outcomeRevision
          ) {
            throw conflict(locked.item, locked.head)
          }
          await assertCurrentAuthority(tx, authorize, {
            item: locked.item,
            actorUserId: command.actorUserId,
            recordedAt: command.recordedAt,
          })
          const corrected = correctFeedbackHandlingOutcome({
            id: command.outcomeId,
            current: headFromRow(locked.head),
            previous: outcomeFromRow(latestRow),
            outcome: command.outcome,
            internalNote: command.internalNote,
            recordedBy: command.actorUserId,
            recordedAt: command.recordedAt,
          })
          if (corrected.isErr()) throw corrected.error
          const nextCommandRevision = locked.item.commandRevision + 1
          const [savedItem] = await tx
            .update(inboxItems)
            .set({
              commandRevision: nextCommandRevision,
              updatedAt: command.recordedAt,
            })
            .where(
              and(
                eq(inboxItems.id, locked.item.id),
                eq(inboxItems.organizationId, locked.item.organizationId),
                eq(inboxItems.commandRevision, locked.item.commandRevision),
                eq(inboxItems.status, 'closed'),
              ),
            )
            .returning()
          if (!savedItem) throw conflict(locked.item, locked.head)
          await tx
            .insert(inboxFeedbackHandlingOutcomes)
            .values(
              outcomeInsert(
                corrected.value,
                latestRow.completionStateRevision,
                nextCommandRevision,
              ),
            )
          const history = await historyFor(
            tx,
            locked.item.id,
            locked.head.currentCycleNumber,
          )
          return {
            item: itemFromRow(savedItem, command.item),
            feedbackHandling: toState(
              headFromRow(locked.head),
              history,
              'private_feedback_handled',
            ),
          }
        })
      }),
  }
}
