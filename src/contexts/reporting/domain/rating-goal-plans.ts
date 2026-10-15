// Property Google rating goal — plans: target, quality and pace (pure).
//
// Round 2 (2026-10-15): a manager picks a plan, not a target and then a pace.
// A plan is a target (a tenth), a planned quality (the average stars of new
// Google reviews, rating-goal-quality.ts) and a weekly pace; it needs a
// number of reviews and has a forecast.
//
//   - Every target from the next tenth to 4.9 is worked out at ITS OWN
//     recommended quality and labelled at the Faster pace (R2-4).
//   - The recommended target is the highest Realistic one at most three
//     tenths up, otherwise the next tenth.
//   - The target row of "Build your own" is the next tenth and the two above
//     when that is the recommendation, otherwise the tenths either side of it,
//     never above 4.9 (R2-9).
//   - Three plans share the recommended target's quality (R2-7): Cautious is
//     the recommended target at Steady, Recommended the same at Faster, and
//     Ambitious the highest row target that quality clears by 0.15★ at Push,
//     or the recommended target at Push when it clears no higher one.
//   - Keep is offered only when Google shows 4.9 or 5.0, in place of plans.

import {
  bestCaseReviewsNeeded,
  ratio,
  reviewsNeeded,
  thresholdThousandths,
  type ReviewsNeeded,
} from './rating-goal-numbers'
import type { PaceKey, PaceSuggestions } from './rating-goal-pace'
import {
  minimumQualityTenths,
  qualityChoice,
  type QualityAnchorKind,
  type QualityEvidence,
} from './rating-goal-quality'
import {
  HIGHEST_TARGET_TENTHS,
  stopLabel,
  type RatingGoalNumbers,
  type RatingStopLabel,
} from './rating-goal-stops'

/** The recommended target is at most this many tenths above what Google shows. */
const RECOMMEND_MAX_STEP_TENTHS = 3
/** The target row offers the recommendation and two more tenths. */
const TARGET_ROW_LENGTH = 3

/** Google's numbers and the evidence for a planned quality. */
export type PlanningBasis = RatingGoalNumbers & Readonly<{ evidence: QualityEvidence }>

export type RatingStop = Readonly<{
  targetTenths: number
  /** The planned quality the stop is worked out at: its own recommendation. */
  qualityTenths: number
  qualityAnchor: QualityAnchorKind
  reviewsNeeded: ReviewsNeeded
  /** Reviews needed if every new review is five stars. */
  bestCase: ReviewsNeeded
  label: RatingStopLabel
}>

export type RatingPlanKey = 'cautious' | 'recommended' | 'ambitious'

export type RatingPlan = Readonly<{
  key: RatingPlanKey
  targetTenths: number
  qualityTenths: number
  paceKey: PaceKey
  pacePerWeek: number
}>

export type PlanNeeds = Readonly<{
  reviewsNeeded: ReviewsNeeded
  bestCase: ReviewsNeeded
}>

/** Reviews needed at a planned quality, and if every new review is five stars. */
export function planNeeds(
  numbers: RatingGoalNumbers,
  targetTenths: number,
  qualityTenths: number,
): PlanNeeds {
  const plan = {
    reviewCount: numbers.reviewCount,
    exact: numbers.exact,
    thresholdThousandths: thresholdThousandths(targetTenths),
  }
  return {
    reviewsNeeded: reviewsNeeded({ ...plan, mix: ratio(qualityTenths, 10) }),
    bestCase: bestCaseReviewsNeeded(plan),
  }
}

/** Every target from the tenth above what Google shows to 4.9, at its own quality. */
export function ratingStops(basis: PlanningBasis, fasterPerWeek: number): RatingStop[] {
  const stops: RatingStop[] = []
  for (
    let tenths = basis.displayedTenths + 1;
    tenths <= HIGHEST_TARGET_TENTHS;
    tenths++
  ) {
    const { recommended } = qualityChoice(basis.evidence, tenths)
    const needs = planNeeds(basis, tenths, recommended.qualityTenths)
    stops.push({
      targetTenths: tenths,
      qualityTenths: recommended.qualityTenths,
      qualityAnchor: recommended.kind,
      ...needs,
      label: stopLabel(needs.reviewsNeeded, fasterPerWeek),
    })
  }
  return stops
}

/** The highest Realistic stop at most three tenths up, else the next tenth. */
export function recommendedTarget(
  displayedTenths: number,
  stops: readonly RatingStop[],
): number | null {
  const ceiling = displayedTenths + RECOMMEND_MAX_STEP_TENTHS
  const realistic = stops.filter(
    (stop) => stop.label === 'realistic' && stop.targetTenths <= ceiling,
  )
  return realistic.at(-1)?.targetTenths ?? stops[0]?.targetTenths ?? null
}

/** The targets "Build your own" offers around the recommendation, lowest first. */
export function targetRow(displayedTenths: number, recommendedTenths: number): number[] {
  const first =
    recommendedTenths === displayedTenths + 1 ? recommendedTenths : recommendedTenths - 1
  return Array.from({ length: TARGET_ROW_LENGTH }, (_, step) => first + step).filter(
    (tenths) => tenths <= HIGHEST_TARGET_TENTHS,
  )
}

/** The highest row target above the recommendation the quality clears by 0.15★. */
function ambitiousTarget(
  displayedTenths: number,
  recommendedTenths: number,
  qualityTenths: number,
): number {
  const higher = targetRow(displayedTenths, recommendedTenths).filter(
    (tenths) =>
      tenths > recommendedTenths && qualityTenths >= minimumQualityTenths(tenths),
  )
  return higher.at(-1) ?? recommendedTenths
}

export type RatingPlansInput = Readonly<{
  displayedTenths: number
  recommendedTenths: number
  /** The one quality every plan assumes. */
  qualityTenths: number
  paces: PaceSuggestions
}>

/** Cautious, Recommended and Ambitious, in that order. */
export function ratingPlans(input: RatingPlansInput): RatingPlan[] {
  const plan = (key: RatingPlanKey, targetTenths: number, paceKey: PaceKey) => ({
    key,
    targetTenths,
    qualityTenths: input.qualityTenths,
    paceKey,
    pacePerWeek: input.paces[paceKey],
  })
  return [
    plan('cautious', input.recommendedTenths, 'steady'),
    plan('recommended', input.recommendedTenths, 'faster'),
    plan(
      'ambitious',
      ambitiousTarget(
        input.displayedTenths,
        input.recommendedTenths,
        input.qualityTenths,
      ),
      'push',
    ),
  ]
}

/** Keep is offered, in place of plans, only when Google shows 4.9 or 5.0. */
export const offerKeepFirst = (displayedTenths: number): boolean =>
  displayedTenths >= HIGHEST_TARGET_TENTHS
