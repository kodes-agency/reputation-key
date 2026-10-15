// Property Google rating goal — what a manager types in, worked out on the
// page (pure, no server code).
//
// The setup read returns its plans and stops with the exact inputs it worked
// them out from (`forecastInputs`). A pace or a whole plan the manager types
// in ("Build your own") is worked out here from those inputs, with the same
// domain maths, so the page answers as the manager types.

import {
  isValidPace,
  MAX_PACE_PER_WEEK,
  MIN_PACE_PER_WEEK,
  surgeCaution,
} from '../domain/rating-goal-pace'
import { planNeeds } from '../domain/rating-goal-plans'
import { minimumQualityTenths, qualityChoice } from '../domain/rating-goal-quality'
import { HIGHEST_TARGET_TENTHS, PERFECT_TENTHS } from '../domain/rating-goal-stops'
import type {
  RatingGoalForecastInputs,
  RatingGoalPacePreview,
  RatingGoalPlanDraft,
  RatingGoalPlanPreview,
  RatingPaceView,
  RatingPlanProblem,
} from './dto/rating-goal.types'
import { paceViewOf, planForecast, planningBasis } from './rating-goal-planning'

/**
 * A weekly pace per week, month and day, worded as the setup read words its
 * suggested paces: for a goal's chosen pace on its card and its detail page.
 */
export const ratingGoalPaceView = (pacePerWeek: number): RatingPaceView =>
  paceViewOf(pacePerWeek)

/** A typed pace for one target, at that target's recommended quality. */
export function previewRatingGoalPace(
  inputs: RatingGoalForecastInputs,
  targetTenths: number,
  pacePerWeek: number,
): RatingGoalPacePreview {
  const quality = qualityChoice(planningBasis(inputs).evidence, targetTenths).recommended
  return {
    pace: ratingGoalPaceView(pacePerWeek),
    forecast: planForecast(inputs, targetTenths, quality.qualityTenths, pacePerWeek),
    surgeCaution: surgeCaution(pacePerWeek, inputs.reviewsLast28Days),
  }
}

const targetInRange = (inputs: RatingGoalForecastInputs, tenths: number): boolean =>
  Number.isInteger(tenths) &&
  tenths > inputs.displayedTenths &&
  tenths <= HIGHEST_TARGET_TENTHS

function qualityIssue(
  targetTenths: number,
  qualityTenths: number,
): RatingPlanProblem | null {
  if (!Number.isInteger(qualityTenths) || qualityTenths > PERFECT_TENTHS) {
    return {
      field: 'quality',
      code: 'quality_out_of_range',
      maximumTenths: PERFECT_TENTHS,
    }
  }
  const minimumTenths = minimumQualityTenths(targetTenths)
  return qualityTenths < minimumTenths
    ? { field: 'quality', code: 'quality_too_low', minimumTenths }
    : null
}

/** Each field's problem, the quality judged against the target only when that is valid. */
function planProblems(
  inputs: RatingGoalForecastInputs,
  draft: RatingGoalPlanDraft,
): RatingPlanProblem[] {
  const problems: RatingPlanProblem[] = []
  if (!targetInRange(inputs, draft.targetTenths)) {
    problems.push({
      field: 'target',
      code: 'target_out_of_range',
      minimumTenths: inputs.displayedTenths + 1,
      maximumTenths: HIGHEST_TARGET_TENTHS,
    })
  } else {
    const quality = qualityIssue(draft.targetTenths, draft.qualityTenths)
    if (quality !== null) problems.push(quality)
  }
  if (!isValidPace(draft.pacePerWeek)) {
    problems.push({
      field: 'pace',
      code: 'pace_out_of_range',
      minimum: MIN_PACE_PER_WEEK,
      maximum: MAX_PACE_PER_WEEK,
    })
  }
  return problems
}

/**
 * "Build your own"'s live total for any target, quality and pace: reviews
 * needed, the best case and the forecast, or why the draft cannot be set
 * (the same rules the set and change commands apply).
 */
export function previewRatingGoalPlan(
  inputs: RatingGoalForecastInputs,
  draft: RatingGoalPlanDraft,
): RatingGoalPlanPreview {
  const problems = planProblems(inputs, draft)
  if (problems.length > 0) return { valid: false, problems }
  const needs = planNeeds(planningBasis(inputs), draft.targetTenths, draft.qualityTenths)
  return {
    valid: true,
    reviewsNeeded: needs.reviewsNeeded === 'unreachable' ? null : needs.reviewsNeeded,
    bestCase: needs.bestCase === 'unreachable' ? null : needs.bestCase,
    pace: ratingGoalPaceView(draft.pacePerWeek),
    forecast: planForecast(
      inputs,
      draft.targetTenths,
      draft.qualityTenths,
      draft.pacePerWeek,
    ),
    surgeCaution: surgeCaution(draft.pacePerWeek, inputs.reviewsLast28Days),
  }
}
