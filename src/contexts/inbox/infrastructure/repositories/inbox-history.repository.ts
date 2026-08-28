// Inbox context — Drizzle Handling History read model (IBX-01-T5).
//
// Five append-only tables, one story. Each source is read with an explicit
// LIMIT and an organization_id predicate, then merged by the pure domain
// ordering rule. The tenant fence is on every query, not on the merge: an item
// id belonging to another Organization returns an empty page, never rows.
//
// The transitions log is NOT queried here directly — `handling-cycle-transitions.read`
// is its one reader, shared with the private-feedback store so both agree that
// `state_revision` is the ordering key.

import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  inboxAssignmentHistory,
  inboxEscalationHistory,
  inboxFeedbackHandlingOutcomes,
  inboxHandlingCycles,
} from '#/shared/db/schema/inbox.schema'
import { trace } from '#/shared/observability/trace'
import { inboxItemId as toInboxItemId, userId as toUserId } from '#/shared/domain/ids'
import type { InboxItemId, UserId } from '#/shared/domain/ids'
import {
  INBOX_HISTORY_SOURCE_LIMIT,
  type InboxHistoryPage,
  type InboxHistoryRepository,
} from '../../application/ports/inbox-history.repository'
import {
  orderInboxHistory,
  redactLegacyActor,
  type InboxAssignmentReason,
  type InboxHistoryEntry,
} from '../../domain/handling-history'
import type {
  FeedbackHandlingDeadlineResult,
  PrivateFeedbackHandlingOutcome,
} from '../../domain/feedback-handling'
import type {
  HandlingCycleActorType,
  HandlingCycleOpenReason,
  HandlingCycleTransitionKind,
  ManualReopenReason,
} from '../../domain/types'
import { selectHandlingCycleTransitions } from '../handling-cycle-transitions.read'

const optionalUserId = (value: string | null): UserId | null =>
  value === null ? null : toUserId(value)

/** `legacy_backfill` is the cutover's own marker for a pre-cutover episode. */
const LEGACY_REASON = 'legacy_backfill'

export const createInboxHistoryRepository = (db: Database): InboxHistoryRepository =>
  Object.freeze({
    findByInboxItemId: async (input): Promise<InboxHistoryPage> => {
      const limit = input.limit ?? INBOX_HISTORY_SOURCE_LIMIT
      const itemId = input.inboxItemId as string
      const organizationId = input.organizationId as string

      return trace('inboxHistory.findByInboxItemId', async () => {
        const cycleRows = await db
          .select({
            cycleNumber: inboxHandlingCycles.cycleNumber,
            sourceRevision: inboxHandlingCycles.sourceRevision,
            openedReason: inboxHandlingCycles.openedReason,
            manualReopenReason: inboxHandlingCycles.manualReopenReason,
            manualReopenExplanation: inboxHandlingCycles.manualReopenExplanation,
            supersedesCycleNumber: inboxHandlingCycles.supersedesCycleNumber,
            openedBy: inboxHandlingCycles.openedBy,
            openedAt: inboxHandlingCycles.openedAt,
          })
          .from(inboxHandlingCycles)
          .where(
            and(
              eq(inboxHandlingCycles.inboxItemId, itemId),
              eq(inboxHandlingCycles.organizationId, organizationId),
            ),
          )
          .orderBy(asc(inboxHandlingCycles.cycleNumber))
          .limit(limit)

        const transitionRows = await selectHandlingCycleTransitions(db, {
          inboxItemId: itemId,
          organizationId,
          limit,
        })

        const assignmentRows = await db
          .select({
            resultingCommandRevision: inboxAssignmentHistory.resultingCommandRevision,
            handlingCycleNumber: inboxAssignmentHistory.handlingCycleNumber,
            previousAssignee: inboxAssignmentHistory.previousAssignee,
            nextAssignee: inboxAssignmentHistory.nextAssignee,
            reason: inboxAssignmentHistory.reason,
            actorUserId: inboxAssignmentHistory.actorUserId,
            bulkId: inboxAssignmentHistory.bulkId,
            occurredAt: inboxAssignmentHistory.occurredAt,
          })
          .from(inboxAssignmentHistory)
          .where(
            and(
              eq(inboxAssignmentHistory.inboxItemId, itemId),
              eq(inboxAssignmentHistory.organizationId, organizationId),
            ),
          )
          .orderBy(asc(inboxAssignmentHistory.resultingCommandRevision))
          .limit(limit)

        const escalationRows = await db
          .select({
            resultingCommandRevision: inboxEscalationHistory.resultingCommandRevision,
            handlingCycleNumber: inboxEscalationHistory.handlingCycleNumber,
            kind: inboxEscalationHistory.kind,
            actorUserId: inboxEscalationHistory.actorUserId,
            occurredAt: inboxEscalationHistory.occurredAt,
          })
          .from(inboxEscalationHistory)
          .where(
            and(
              eq(inboxEscalationHistory.inboxItemId, itemId),
              eq(inboxEscalationHistory.organizationId, organizationId),
            ),
          )
          .orderBy(asc(inboxEscalationHistory.resultingCommandRevision))
          .limit(limit)

        const outcomeRows = await db
          .select({
            id: inboxFeedbackHandlingOutcomes.id,
            cycleNumber: inboxFeedbackHandlingOutcomes.cycleNumber,
            outcomeRevision: inboxFeedbackHandlingOutcomes.outcomeRevision,
            outcome: inboxFeedbackHandlingOutcomes.outcome,
            internalNote: inboxFeedbackHandlingOutcomes.internalNote,
            recordedBy: inboxFeedbackHandlingOutcomes.recordedBy,
            recordedAt: inboxFeedbackHandlingOutcomes.recordedAt,
            completionAt: inboxFeedbackHandlingOutcomes.completionAt,
            completionStateRevision:
              inboxFeedbackHandlingOutcomes.completionStateRevision,
            deadlineResult: inboxFeedbackHandlingOutcomes.deadlineResult,
            supersedesOutcomeId: inboxFeedbackHandlingOutcomes.supersedesOutcomeId,
          })
          .from(inboxFeedbackHandlingOutcomes)
          .where(
            and(
              eq(inboxFeedbackHandlingOutcomes.inboxItemId, itemId),
              eq(inboxFeedbackHandlingOutcomes.organizationId, organizationId),
            ),
          )
          .orderBy(
            asc(inboxFeedbackHandlingOutcomes.cycleNumber),
            asc(inboxFeedbackHandlingOutcomes.outcomeRevision),
          )
          .limit(limit)

        const inboxItem: InboxItemId = toInboxItemId(itemId)
        const cycleEntries = cycleRows.map((row): InboxHistoryEntry => {
          const legacy = row.openedReason === LEGACY_REASON
          return redactLegacyActor({
            id: `cycle:${itemId}:${row.cycleNumber}`,
            inboxItemId: inboxItem,
            kind: 'cycle_opened',
            occurredAt: row.openedAt,
            cycleNumber: row.cycleNumber,
            stateRevision: null,
            actorUserId: optionalUserId(row.openedBy),
            actorDisplayName: null,
            legacy,
            detail: {
              kind: 'cycle_opened',
              openedReason: row.openedReason as HandlingCycleOpenReason,
              manualReopenReason: row.manualReopenReason as ManualReopenReason | null,
              manualReopenExplanation: row.manualReopenExplanation,
              supersedesCycleNumber: row.supersedesCycleNumber,
              sourceRevision: row.sourceRevision,
            },
          })
        })

        const transitionEntries = transitionRows.map((row): InboxHistoryEntry => {
          const legacy = row.transitionReason === LEGACY_REASON
          return redactLegacyActor({
            id: `transition:${itemId}:${row.stateRevision}`,
            inboxItemId: inboxItem,
            kind: 'cycle_transition',
            occurredAt: row.transitionedAt,
            cycleNumber: row.cycleNumber,
            stateRevision: row.stateRevision,
            actorUserId: optionalUserId(row.actorUserId),
            actorDisplayName: null,
            legacy,
            detail: {
              kind: 'cycle_transition',
              transition: row.kind as HandlingCycleTransitionKind,
              transitionReason: row.transitionReason,
              actorType: row.actorType as HandlingCycleActorType,
            },
          })
        })

        const assignmentEntries = assignmentRows.map((row): InboxHistoryEntry => ({
          id: `assignment:${itemId}:${row.resultingCommandRevision}`,
          inboxItemId: inboxItem,
          kind: 'assignment',
          occurredAt: row.occurredAt,
          cycleNumber: row.handlingCycleNumber,
          stateRevision: null,
          actorUserId: optionalUserId(row.actorUserId),
          actorDisplayName: null,
          legacy: false,
          detail: {
            kind: 'assignment',
            reason: row.reason as InboxAssignmentReason,
            previousAssignee: optionalUserId(row.previousAssignee),
            nextAssignee: optionalUserId(row.nextAssignee),
            previousAssigneeDisplayName: null,
            nextAssigneeDisplayName: null,
            bulkId: row.bulkId,
          },
        }))

        const escalationEntries = escalationRows.map((row): InboxHistoryEntry => ({
          id: `escalation:${itemId}:${row.resultingCommandRevision}`,
          inboxItemId: inboxItem,
          kind: 'escalation',
          occurredAt: row.occurredAt,
          cycleNumber: row.handlingCycleNumber,
          stateRevision: null,
          actorUserId: optionalUserId(row.actorUserId),
          actorDisplayName: null,
          legacy: false,
          detail: {
            kind: 'escalation',
            escalation: row.kind === 'resolved' ? 'resolved' : 'escalated',
          },
        }))

        const outcomeEntries = outcomeRows.map((row): InboxHistoryEntry => {
          // The raw note travels no further than the use case, which owns the
          // permission decision. It is included conditionally so that "no note
          // recorded" and "note withheld" are the same shape downstream.
          const note = row.internalNote
          return {
            id: `outcome:${row.id}:${row.outcomeRevision}`,
            inboxItemId: inboxItem,
            kind: 'handling_outcome',
            occurredAt: row.recordedAt,
            cycleNumber: row.cycleNumber,
            stateRevision: row.completionStateRevision,
            actorUserId: toUserId(row.recordedBy),
            actorDisplayName: null,
            legacy: false,
            detail: {
              kind: 'handling_outcome',
              outcome: row.outcome as PrivateFeedbackHandlingOutcome,
              outcomeRevision: row.outcomeRevision,
              deadlineResult: row.deadlineResult as FeedbackHandlingDeadlineResult,
              completionAt: row.completionAt,
              supersedesOutcomeId: row.supersedesOutcomeId,
              ...(note === null ? {} : { internalNote: note }),
            },
          }
        })

        const truncated = [
          cycleRows.length,
          transitionRows.length,
          assignmentRows.length,
          escalationRows.length,
          outcomeRows.length,
        ].some((count) => count >= limit)

        return {
          entries: orderInboxHistory([
            ...cycleEntries,
            ...transitionEntries,
            ...assignmentEntries,
            ...escalationEntries,
            ...outcomeEntries,
          ]),
          truncated,
        }
      })
    },
  })
