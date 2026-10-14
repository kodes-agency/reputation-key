// Property Google rating goal — the aggregate and its rules (pure).
//
// A Property's Google rating goal is NOT a Goal Program: it has no months, no
// subjects and no metric reading. One Property holds at most one active goal.
// A climb goal aims at a tenth Google will show and carries a weekly pace; a
// keep goal watches a tenth Google shows now and carries no pace. A goal runs
// until Google shows the target (reached), or it is ended: by a manager, by
// the Google location changing under it, or by the Property being archived.
// Changes to target, pace or mode are logged with who and when, old -> new,
// and no reason (DECISIONS.md Q6).

import { createErrorFactory } from '#/shared/domain/errors'
import { isValidPace } from './rating-goal-pace'
import { HIGHEST_TARGET_TENTHS, PERFECT_TENTHS } from './rating-goal-stops'

export type RatingGoalMode = 'climb' | 'keep'
export type RatingGoalState = 'active' | 'reached' | 'ended'
export type RatingGoalEndedReason =
  'manager' | 'google_location_changed' | 'property_archived'
export type RatingGoalChangeField = 'target' | 'pace' | 'mode'

export type RatingGoalStatus =
  | 'waiting_for_google'
  | 'reached'
  | 'cant_reach_at_mix'
  | 'getting_started'
  | 'on_pace'
  | 'below_pace'
  | 'holding'
  | 'dropped_below'

export const RATING_GOAL_MODES = ['climb', 'keep'] as const
export const RATING_GOAL_STATUSES = [
  'waiting_for_google',
  'reached',
  'cant_reach_at_mix',
  'getting_started',
  'on_pace',
  'below_pace',
  'holding',
  'dropped_below',
] as const satisfies readonly RatingGoalStatus[]

/** The lowest tenth a goal may name (1.0). */
export const LOWEST_TARGET_TENTHS = 10

export type RatingGoalPlan = Readonly<{
  mode: RatingGoalMode
  targetTenths: number
  pacePerWeek: number | null
}>

export type RatingGoalBaseline = Readonly<{
  /** Google's review count when the goal was set. */
  reviewCount: number
  /** Google's own average when the goal was set. */
  googleAverage: number
  /** The exact average the goal's progress starts from. */
  exactAverage: number
}>

/** What the last evaluation stored, so a later one can tell what changed. */
export type RatingGoalEvaluationMark = Readonly<{
  displayedTenths: number | null
  status: RatingGoalStatus | null
  evaluatedAt: Date | null
}>

export type PropertyRatingGoal = RatingGoalPlan &
  Readonly<{
    id: string
    organizationId: string
    propertyId: string
    /** The Property's Google binding epoch when the goal was set. */
    sourceEpoch: number
    state: RatingGoalState
    endedReason: RatingGoalEndedReason | null
    baseline: RatingGoalBaseline
    lastEvaluation: RatingGoalEvaluationMark
    reachedAt: Date | null
    endedAt: Date | null
    createdBy: string
    createdAt: Date
    updatedAt: Date
    /** Optimistic concurrency: a change names the version it was made on. */
    version: number
  }>

export type RatingGoalChange = Readonly<{
  id: string
  goalId: string
  organizationId: string
  propertyId: string
  changedBy: string
  changedAt: Date
  field: RatingGoalChangeField
  oldValue: string | null
  newValue: string | null
}>

export type RatingGoalChangeRow = Pick<
  RatingGoalChange,
  'field' | 'oldValue' | 'newValue'
>

export type RatingGoalErrorCode =
  | 'forbidden'
  | 'not_found'
  /** Fewer than ten Google reviews, or no current numbers from Google. */
  | 'not_eligible'
  /** The Property already has an active rating goal. */
  | 'goal_exists'
  /** The goal was reached or ended; it can no longer change. */
  | 'not_active'
  /** The goal changed since the form was opened. */
  | 'version_conflict'
  | 'invalid_target'
  | 'invalid_pace'
  /** A change that changes nothing. */
  | 'no_change'
  /** The Organization's closure holds it: no goal is set there. */
  | 'organization_closing'

export type RatingGoalError = Readonly<{
  _tag: 'RatingGoalError'
  code: RatingGoalErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

export const ratingGoalError = createErrorFactory<
  RatingGoalError['_tag'],
  RatingGoalErrorCode
>('RatingGoalError')

export const isRatingGoalError = (error: unknown): error is RatingGoalError & Error =>
  error instanceof Error && (error as Partial<RatingGoalError>)._tag === 'RatingGoalError'

const isTenth = (value: number): boolean => Number.isInteger(value)

/**
 * A climb goal names a tenth above what Google shows, up to 4.9 (5.0 needs
 * every review to be five stars). A keep goal names a tenth Google shows now
 * or a lower one, 5.0 included.
 */
export function targetProblem(
  mode: RatingGoalMode,
  targetTenths: number,
  displayedTenths: number,
): 'invalid_target' | null {
  if (!isTenth(targetTenths)) return 'invalid_target'
  if (mode === 'climb') {
    return targetTenths > displayedTenths && targetTenths <= HIGHEST_TARGET_TENTHS
      ? null
      : 'invalid_target'
  }
  return targetTenths >= LOWEST_TARGET_TENTHS &&
    targetTenths <= Math.min(displayedTenths, PERFECT_TENTHS)
    ? null
    : 'invalid_target'
}

/** A climb goal needs a whole weekly pace from 1 to 200; a keep goal has none. */
export function paceProblem(
  mode: RatingGoalMode,
  pacePerWeek: number | null,
): 'invalid_pace' | null {
  if (mode === 'keep') return pacePerWeek === null ? null : 'invalid_pace'
  return pacePerWeek !== null && isValidPace(pacePerWeek) ? null : 'invalid_pace'
}

const asText = (value: number | null): string | null =>
  value === null ? null : String(value)

/** The change log rows that take a plan from `current` to `next`, mode first. */
export function planChanges(
  current: RatingGoalPlan,
  next: RatingGoalPlan,
): readonly RatingGoalChangeRow[] {
  const rows: RatingGoalChangeRow[] = []
  if (current.mode !== next.mode) {
    rows.push({ field: 'mode', oldValue: current.mode, newValue: next.mode })
  }
  if (current.targetTenths !== next.targetTenths) {
    rows.push({
      field: 'target',
      oldValue: asText(current.targetTenths),
      newValue: asText(next.targetTenths),
    })
  }
  if (current.pacePerWeek !== next.pacePerWeek) {
    rows.push({
      field: 'pace',
      oldValue: asText(current.pacePerWeek),
      newValue: asText(next.pacePerWeek),
    })
  }
  return rows
}
