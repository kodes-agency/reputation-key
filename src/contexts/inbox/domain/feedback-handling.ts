import { err, ok, type Result } from '#/shared/domain'
import { feedbackId, type FeedbackId, type UserId } from '#/shared/domain/ids'
import { inboxError, type InboxError } from './errors'
import type { HandlingCycleHead } from './types'

export const PRIVATE_FEEDBACK_HANDLING_OUTCOMES = [
  'follow_up_completed',
  'follow_up_attempted',
  'handled_with_team',
  'reviewed_no_additional_step',
  'content_concern_reviewed',
] as const

export type PrivateFeedbackHandlingOutcome =
  (typeof PRIVATE_FEEDBACK_HANDLING_OUTCOMES)[number]

export type FeedbackHandlingDeadlineResult = 'on_time' | 'late' | 'not_measured'

export type FeedbackHandlingOutcomeFact = Readonly<{
  id: string
  inboxItemId: HandlingCycleHead['inboxItemId']
  organizationId: HandlingCycleHead['organizationId']
  propertyId: HandlingCycleHead['propertyId']
  feedbackId: FeedbackId
  cycleNumber: number
  sourceRevision: number
  outcomeRevision: number
  outcome: PrivateFeedbackHandlingOutcome
  internalNote: string | null
  recordedBy: UserId
  recordedAt: Date
  completionAt: Date
  deadlineResult: FeedbackHandlingDeadlineResult
  supersedesOutcomeId: string | null
}>

type RecordFeedbackHandlingOutcomeInput = Readonly<{
  id: string
  current: HandlingCycleHead
  outcome: PrivateFeedbackHandlingOutcome
  internalNote: string | null
  recordedBy: UserId
  recordedAt: Date
  deadlineResult: FeedbackHandlingDeadlineResult
}>

type CorrectFeedbackHandlingOutcomeInput = Readonly<{
  id: string
  current: HandlingCycleHead
  previous: FeedbackHandlingOutcomeFact
  outcome: PrivateFeedbackHandlingOutcome
  internalNote: string | null
  recordedBy: UserId
  recordedAt: Date
}>

const isOutcome = (value: string): value is PrivateFeedbackHandlingOutcome =>
  PRIVATE_FEEDBACK_HANDLING_OUTCOMES.some((candidate) => candidate === value)

const normalizeInternalNote = (
  value: string | null,
): Result<string | null, InboxError> => {
  const normalized = value?.trim() ?? ''
  if (normalized.length > 2_000) {
    return err(inboxError('invalid_input', 'Internal handling note is too long'))
  }
  return ok(normalized.length === 0 ? null : normalized)
}

const assertFeedbackCycle = (
  current: HandlingCycleHead,
  expectedStatus: HandlingCycleHead['status'],
): Result<true, InboxError> => {
  if (current.sourceType !== 'feedback') {
    return err(
      inboxError(
        'invalid_input',
        'Only a private-feedback Handling Cycle accepts a manager outcome',
      ),
    )
  }
  if (current.status !== expectedStatus) {
    return err(
      inboxError(
        'invalid_transition',
        expectedStatus === 'open'
          ? 'Private feedback is not open for handling'
          : 'Only completed private feedback accepts an outcome correction',
      ),
    )
  }
  return ok(true)
}

export function recordFeedbackHandlingOutcome(
  input: RecordFeedbackHandlingOutcomeInput,
): Result<FeedbackHandlingOutcomeFact, InboxError> {
  const cycle = assertFeedbackCycle(input.current, 'open')
  if (cycle.isErr()) return err(cycle.error)
  if (!isOutcome(input.outcome)) {
    return err(inboxError('invalid_input', 'Choose one approved handling outcome'))
  }
  const note = normalizeInternalNote(input.internalNote)
  if (note.isErr()) return err(note.error)

  return ok({
    id: input.id,
    inboxItemId: input.current.inboxItemId,
    organizationId: input.current.organizationId,
    propertyId: input.current.propertyId,
    feedbackId: feedbackId(input.current.sourceId),
    cycleNumber: input.current.currentCycleNumber,
    sourceRevision: input.current.currentSourceRevision,
    outcomeRevision: 1,
    outcome: input.outcome,
    internalNote: note.value,
    recordedBy: input.recordedBy,
    recordedAt: input.recordedAt,
    completionAt: input.recordedAt,
    deadlineResult: input.deadlineResult,
    supersedesOutcomeId: null,
  })
}

export function correctFeedbackHandlingOutcome(
  input: CorrectFeedbackHandlingOutcomeInput,
): Result<FeedbackHandlingOutcomeFact, InboxError> {
  const cycle = assertFeedbackCycle(input.current, 'closed')
  if (cycle.isErr()) return err(cycle.error)
  if (
    input.previous.inboxItemId !== input.current.inboxItemId ||
    input.previous.organizationId !== input.current.organizationId ||
    input.previous.feedbackId !== input.current.sourceId ||
    input.previous.cycleNumber !== input.current.currentCycleNumber ||
    input.previous.sourceRevision !== input.current.currentSourceRevision
  ) {
    return err(
      inboxError('revision_conflict', 'Handling outcome is not current for this cycle'),
    )
  }
  if (!isOutcome(input.outcome)) {
    return err(inboxError('invalid_input', 'Choose one approved handling outcome'))
  }
  const note = normalizeInternalNote(input.internalNote)
  if (note.isErr()) return err(note.error)
  const outcomeRevision = input.previous.outcomeRevision + 1
  if (!Number.isSafeInteger(outcomeRevision)) {
    return err(inboxError('revision_conflict', 'Handling outcome revision is exhausted'))
  }

  return ok({
    ...input.previous,
    id: input.id,
    outcomeRevision,
    outcome: input.outcome,
    internalNote: note.value,
    recordedBy: input.recordedBy,
    recordedAt: input.recordedAt,
    completionAt: input.previous.completionAt,
    deadlineResult: input.previous.deadlineResult,
    supersedesOutcomeId: input.previous.id,
  })
}
