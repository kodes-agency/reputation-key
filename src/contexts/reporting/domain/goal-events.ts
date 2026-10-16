// Goal context — domain events

import { newEventId } from '#/shared/domain/event-id'
import { assert } from '#/shared/domain/assert'
import type { GoalMetricEvaluation } from './goal-program'
import type { RatingGoalMode } from './rating-goal'
import type {
  RatingGoalNotice,
  RatingGoalPaceWindowKind,
  RatingGoalTransition,
} from './rating-goal-notices'

type GoalMonthlyResultEventArgs = Readonly<{
  organizationId: string
  propertyId: string
  programId: string
  programVersionId: string
  assignmentId: string
  monthlyResultId: string
  periodStart: Date
  periodEnd: Date
  evaluationState: GoalMetricEvaluation['state']
  achieved: boolean | null
  occurredAt: Date
  correlationId?: string | null
}>

export type GoalMonthlyResultClosed = Readonly<{
  _tag: 'goal.monthly_result.closed'
  eventId: string
  organizationId: string
  propertyId: string
  programId: string
  programVersionId: string
  assignmentId: string
  monthlyResultId: string
  periodStart: Date
  periodEnd: Date
  status: 'closed'
  evaluationState: GoalMetricEvaluation['state']
  achieved: boolean | null
  occurredAt: Date
  correlationId: string | null
}>

export type GoalMonthlyResultReconciled = Readonly<{
  _tag: 'goal.monthly_result.reconciled'
  eventId: string
  organizationId: string
  propertyId: string
  programId: string
  programVersionId: string
  assignmentId: string
  monthlyResultId: string
  periodStart: Date
  periodEnd: Date
  status: 'reconciling'
  evaluationState: GoalMetricEvaluation['state']
  achieved: boolean | null
  occurredAt: Date
  correlationId: string | null
}>

export type GoalMonthlyResultRevised = Readonly<{
  _tag: 'goal.monthly_result.revised'
  eventId: string
  organizationId: string
  propertyId: string
  programId: string
  programVersionId: string
  assignmentId: string
  monthlyResultId: string
  periodStart: Date
  periodEnd: Date
  status: 'closed'
  evaluationState: GoalMetricEvaluation['state']
  achieved: boolean | null
  revisionId: string
  revision: number
  supersedesRevisionId: string | null
  outcomeChanged: boolean
  availabilityChanged: boolean
  occurredAt: Date
  correlationId: string | null
}>

/**
 * A Property's Google rating goal moved in a way its managers are told about
 * (domain/rating-goal-notices.ts). Identifiers, closed enums and Property-level
 * figures only (ADR 0030): Google's shown tenth, the goal's target and pace,
 * and the recent pace of new reviews. Never a review, a review's rating or an
 * average of review ratings.
 */
export type GoalRatingGoalTransitioned = Readonly<{
  _tag: 'goal.rating_goal.transitioned'
  eventId: string
  organizationId: string
  propertyId: string
  goalId: string
  transition: RatingGoalTransition
  mode: RatingGoalMode
  targetTenths: number
  shownTenths: number | null
  previousTenths: number | null
  /** Legacy: whole reviews a week, one release; dropped once the outbox drained. */
  pacePerWeek: number | null
  /** The goal's pace in tenths of a review a week. */
  paceTenthsPerWeek: number | null
  recentPaceTenths: number | null
  paceWindow: RatingGoalPaceWindowKind | null
  occurredAt: Date
  correlationId: string | null
}>

export type GoalEvent =
  | GoalMonthlyResultClosed
  | GoalMonthlyResultReconciled
  | GoalMonthlyResultRevised
  | GoalRatingGoalTransitioned

function validateMonthlyResultEvent(
  args: GoalMonthlyResultEventArgs,
  status: 'closed' | 'reconciling',
): void {
  assert(args.organizationId.trim().length > 0, 'monthly result organizationId required')
  assert(args.propertyId.trim().length > 0, 'monthly result propertyId required')
  assert(args.periodStart instanceof Date, 'monthly result periodStart must be Date')
  assert(args.periodEnd instanceof Date, 'monthly result periodEnd must be Date')
  assert(args.occurredAt instanceof Date, 'monthly result occurredAt must be Date')
  assert(args.periodEnd > args.periodStart, 'monthly result period must be non-empty')
  assert(
    args.evaluationState === 'eligible'
      ? typeof args.achieved === 'boolean'
      : args.achieved === null,
    'monthly result achievement must match evaluation state',
  )
  assert(
    status !== 'closed' || args.evaluationState !== 'updating',
    'closed monthly result cannot still be updating',
  )
}

export const goalMonthlyResultClosed = (
  args: GoalMonthlyResultEventArgs,
): GoalMonthlyResultClosed => {
  validateMonthlyResultEvent(args, 'closed')
  return {
    _tag: 'goal.monthly_result.closed',
    eventId: newEventId(),
    organizationId: args.organizationId,
    propertyId: args.propertyId,
    programId: args.programId,
    programVersionId: args.programVersionId,
    assignmentId: args.assignmentId,
    monthlyResultId: args.monthlyResultId,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    status: 'closed',
    evaluationState: args.evaluationState,
    achieved: args.achieved,
    occurredAt: args.occurredAt,
    correlationId: args.correlationId ?? null,
  }
}

export const goalMonthlyResultReconciled = (
  args: GoalMonthlyResultEventArgs,
): GoalMonthlyResultReconciled => {
  validateMonthlyResultEvent(args, 'reconciling')
  return {
    _tag: 'goal.monthly_result.reconciled',
    eventId: newEventId(),
    organizationId: args.organizationId,
    propertyId: args.propertyId,
    programId: args.programId,
    programVersionId: args.programVersionId,
    assignmentId: args.assignmentId,
    monthlyResultId: args.monthlyResultId,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    status: 'reconciling',
    evaluationState: args.evaluationState,
    achieved: args.achieved,
    occurredAt: args.occurredAt,
    correlationId: args.correlationId ?? null,
  }
}

type GoalMonthlyResultRevisedArgs = GoalMonthlyResultEventArgs &
  Readonly<{
    revisionId: string
    revision: number
    supersedesRevisionId: string | null
    outcomeChanged: boolean
    availabilityChanged: boolean
  }>

export const goalMonthlyResultRevised = (
  args: GoalMonthlyResultRevisedArgs,
): GoalMonthlyResultRevised => {
  validateMonthlyResultEvent(args, 'closed')
  assert(args.revisionId.trim().length > 0, 'monthly result revisionId required')
  assert(
    Number.isSafeInteger(args.revision) && args.revision >= 1,
    'monthly result revision must be positive',
  )
  assert(
    args.revision === 1
      ? args.supersedesRevisionId === null
      : Boolean(args.supersedesRevisionId?.trim()),
    'monthly result revision lineage is invalid',
  )
  return {
    _tag: 'goal.monthly_result.revised',
    eventId: newEventId(),
    organizationId: args.organizationId,
    propertyId: args.propertyId,
    programId: args.programId,
    programVersionId: args.programVersionId,
    assignmentId: args.assignmentId,
    monthlyResultId: args.monthlyResultId,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    status: 'closed',
    evaluationState: args.evaluationState,
    achieved: args.achieved,
    revisionId: args.revisionId,
    revision: args.revision,
    supersedesRevisionId: args.supersedesRevisionId,
    outcomeChanged: args.outcomeChanged,
    availabilityChanged: args.availabilityChanged,
    occurredAt: args.occurredAt,
    correlationId: args.correlationId ?? null,
  }
}

type RatingGoalTransitionedArgs = Readonly<{
  organizationId: string
  propertyId: string
  goalId: string
  mode: RatingGoalMode
  notice: RatingGoalNotice
  occurredAt: Date
}>

/** The one fact per notice an evaluation stores, in the same transaction. */
export const goalRatingGoalTransitioned = (
  args: RatingGoalTransitionedArgs,
): GoalRatingGoalTransitioned => {
  assert(args.organizationId.trim().length > 0, 'rating goal organizationId required')
  assert(args.propertyId.trim().length > 0, 'rating goal propertyId required')
  assert(args.goalId.trim().length > 0, 'rating goal goalId required')
  const { notice } = args
  return {
    _tag: 'goal.rating_goal.transitioned',
    eventId: newEventId(),
    organizationId: args.organizationId,
    propertyId: args.propertyId,
    goalId: args.goalId,
    transition: notice.transition,
    mode: args.mode,
    targetTenths: notice.targetTenths,
    shownTenths: 'shownTenths' in notice ? notice.shownTenths : null,
    previousTenths: 'previousTenths' in notice ? notice.previousTenths : null,
    pacePerWeek: 'pacePerWeek' in notice ? notice.pacePerWeek : null,
    paceTenthsPerWeek: 'paceTenthsPerWeek' in notice ? notice.paceTenthsPerWeek : null,
    recentPaceTenths: 'recentPaceTenths' in notice ? notice.recentPaceTenths : null,
    paceWindow: 'paceWindow' in notice ? notice.paceWindow : null,
    occurredAt: args.occurredAt,
    correlationId: null,
  }
}
