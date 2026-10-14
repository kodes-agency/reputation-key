// Property Google rating goal — evaluating an active goal.
//
// The one evaluation a read and the snapshot consumer share, so a status, a
// reached goal or an ended one is decided the same way wherever it is first
// noticed. In order:
//   1. the Property is no longer live (archived, or on its way out): the goal
//      ends, `property_archived`;
//   2. the Property's Google binding epoch is not the goal's: the Google
//      location changed under it, the goal ends, `google_location_changed`;
//   3. otherwise the domain status (domain/rating-goal-status.ts), and a climb
//      goal Google shows the target of is reached.
// The write stores the tenth Google showed only when Google could be read,
// and is applied only when it changes the row, onto the plan version it was
// worked out on, never over a newer evaluation, and only onto the tenth, known
// status and notice times it read (repository .recordEvaluation). So the
// stored values stay the last ones seen: a later evaluation can tell a tenth
// gained or lost, or a new status, from a repeat, and the notices it decides
// (domain/rating-goal-notices.ts) are written once, with the row.

import type { PropertyRatingGoal, RatingGoalStatus } from '../domain/rating-goal'
import {
  decideRatingGoalNotices,
  type RatingGoalNotice,
  type RatingGoalNoticeDecision,
  type RatingGoalNoticeInput,
} from '../domain/rating-goal-notices'
import { climbStatus, keepStatus } from '../domain/rating-goal-status'
import type {
  PropertyRatingGoalRepository,
  RatingGoalEvaluationWrite,
} from './ports/property-rating-goal.repository'
import type { RatingGoalReading } from './rating-goal-reading'

/** Property lifecycle states in which a rating goal keeps running. */
const LIVE_PROPERTY_STATES: ReadonlySet<string> = new Set(['active', 'suspended'])

export type RatingGoalEvaluation = Readonly<{
  status: RatingGoalStatus
  /** The tenth Google showed; null when Google could not be read. */
  displayedTenths: number | null
  outcome: RatingGoalEvaluationWrite['outcome']
}>

function goalStatus(
  goal: PropertyRatingGoal,
  reading: RatingGoalReading,
  reviewsInPaceWindow: number | null,
): RatingGoalStatus {
  const displayed = reading.google?.displayedTenths ?? 0
  if (goal.mode === 'keep') {
    return keepStatus({
      waiting: reading.waiting,
      displayedTenths: displayed,
      targetTenths: goal.targetTenths,
    })
  }
  if (reading.waiting || reading.mix === null) return 'waiting_for_google'
  return climbStatus({
    waiting: false,
    displayedTenths: displayed,
    targetTenths: goal.targetTenths,
    mix: reading.mix.value,
    goalCreatedAt: goal.createdAt,
    now: reading.now,
    chosenPerWeek: goal.pacePerWeek ?? 0,
    reviewsInPaceWindow,
  })
}

/** What an active goal's evaluation finds at `reading.now`. */
export function evaluateRatingGoal(
  goal: PropertyRatingGoal,
  reading: RatingGoalReading,
  reviewsInPaceWindow: number | null,
): RatingGoalEvaluation {
  const unchanged = goal.lastEvaluation.status ?? 'waiting_for_google'
  if (!LIVE_PROPERTY_STATES.has(reading.facts.lifecycleState)) {
    return {
      status: unchanged,
      displayedTenths: null,
      outcome: { kind: 'ended', reason: 'property_archived' },
    }
  }
  if (reading.facts.sourceEpoch !== goal.sourceEpoch) {
    return {
      status: unchanged,
      displayedTenths: null,
      outcome: { kind: 'ended', reason: 'google_location_changed' },
    }
  }
  const status = goalStatus(goal, reading, reviewsInPaceWindow)
  return {
    status,
    displayedTenths: reading.waiting ? null : (reading.google?.displayedTenths ?? null),
    outcome: status === 'reached' ? { kind: 'reached' } : { kind: 'continues' },
  }
}

/** What the notices of an evaluation are worked out from, beside the goal. */
export type RatingGoalNoticeFacts = Pick<RatingGoalNoticeInput, 'pace'>

/** What an evaluation tells the goal's managers, against the goal as read. */
export const evaluationNotices = (
  goal: PropertyRatingGoal,
  evaluation: RatingGoalEvaluation,
  facts: RatingGoalNoticeFacts,
  now: Date,
): RatingGoalNoticeDecision =>
  decideRatingGoalNotices({
    goal,
    evaluation: {
      status: evaluation.status,
      displayedTenths: evaluation.displayedTenths,
      outcome: evaluation.outcome.kind,
    },
    ...facts,
    now,
  })

export const evaluationWrite = (
  goal: PropertyRatingGoal,
  evaluation: RatingGoalEvaluation,
  decision: RatingGoalNoticeDecision,
  now: Date,
): RatingGoalEvaluationWrite => ({
  organizationId: goal.organizationId,
  propertyId: goal.propertyId,
  goalId: goal.id,
  expectedVersion: goal.version,
  expectedMark: {
    displayedTenths: goal.lastEvaluation.displayedTenths,
    knownStatus: goal.lastEvaluation.knownStatus,
    belowPaceNoticedAt: goal.lastEvaluation.belowPaceNoticedAt,
    cantReachNoticedAt: goal.lastEvaluation.cantReachNoticedAt,
  },
  status: evaluation.status,
  displayedTenths: evaluation.displayedTenths,
  knownStatus: decision.knownStatus,
  belowPaceNoticedAt: decision.belowPaceNoticedAt,
  cantReachNoticedAt: decision.cantReachNoticedAt,
  evaluatedAt: now,
  outcome: evaluation.outcome,
  notices: decision.notices,
})

export type RecordedRatingGoal = Readonly<{
  goal: PropertyRatingGoal
  /** True when this evaluation changed the stored goal. */
  stored: boolean
  /** What the managers are told: none unless this evaluation was stored. */
  notices: readonly RatingGoalNotice[]
}>

function afterEvaluation(
  goal: PropertyRatingGoal,
  evaluation: RatingGoalEvaluation,
  decision: RatingGoalNoticeDecision,
  now: Date,
): PropertyRatingGoal {
  const lastEvaluation = {
    status: evaluation.status,
    displayedTenths: evaluation.displayedTenths ?? goal.lastEvaluation.displayedTenths,
    evaluatedAt: now,
    knownStatus: decision.knownStatus,
    belowPaceNoticedAt: decision.belowPaceNoticedAt,
    cantReachNoticedAt: decision.cantReachNoticedAt,
  }
  switch (evaluation.outcome.kind) {
    case 'continues':
      return { ...goal, lastEvaluation, updatedAt: now }
    case 'reached':
      return { ...goal, lastEvaluation, state: 'reached', reachedAt: now, updatedAt: now }
    case 'ended':
      return {
        ...goal,
        lastEvaluation,
        state: 'ended',
        endedReason: evaluation.outcome.reason,
        endedAt: now,
        updatedAt: now,
      }
  }
}

/**
 * Stores an evaluation, with the facts of the notices it raises, and returns
 * the goal as it now stands. Nothing is stored and nobody is told for a
 * repeat, when another evaluation already took the terminal step or stored a
 * newer reading or the same change, or when a manager changed the plan since
 * it was read: the goal comes back as read, and the next evaluation decides
 * again.
 */
export async function recordRatingGoalEvaluation(
  repository: Pick<PropertyRatingGoalRepository, 'recordEvaluation'>,
  goal: PropertyRatingGoal,
  evaluation: RatingGoalEvaluation,
  facts: RatingGoalNoticeFacts,
  now: Date,
): Promise<RecordedRatingGoal> {
  const decision = evaluationNotices(goal, evaluation, facts, now)
  const stored = await repository.recordEvaluation(
    evaluationWrite(goal, evaluation, decision, now),
  )
  return stored
    ? {
        goal: afterEvaluation(goal, evaluation, decision, now),
        stored,
        notices: decision.notices,
      }
    : { goal, stored, notices: [] }
}
