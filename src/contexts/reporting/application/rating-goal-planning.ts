// Property Google rating goal — "Pick a plan", worked out from the setup
// read's exact inputs (pure, no server code).
//
// The setup read builds its plans from `forecastInputs` with these functions,
// and the page calls the same ones as the manager changes a choice, so both
// always agree and the page answers with no server call:
//   - ratingGoalPlanning: the three plans, the shared quality and the rows of
//     "Build your own" (round 2, R2-6 to R2-9);
//   - ratingGoalPlansAt: the three plans at another shared quality ("Change");
//   - ratingGoalQualityChoice: the quality row for any target;
//   - ratingGoalStops: every target at its own recommended quality.

import {
  ratio,
  thresholdThousandths,
  type ReviewsNeeded,
} from '../domain/rating-goal-numbers'
import { forecastArrival, type RatingForecast } from '../domain/rating-goal-forecast'
import {
  paceSuggestions,
  perDay,
  perMonth,
  type PaceKey,
} from '../domain/rating-goal-pace'
import {
  offerKeepFirst,
  planNeeds,
  ratingPlans,
  ratingStops,
  recommendedTarget,
  targetRow,
  type PlanningBasis,
  type RatingPlan,
  type RatingStop,
} from '../domain/rating-goal-plans'
import {
  qualityChoice,
  qualityProblem,
  type QualityAnchor,
} from '../domain/rating-goal-quality'
import { stopLabel } from '../domain/rating-goal-stops'
import type {
  RatingGoalForecastInputs,
  RatingGoalPlanningView,
  RatingPaceView,
  RatingPlanView,
  RatingQualityChoiceView,
  RatingQualityOptionView,
  RatingStopView,
  RatingTargetOptionView,
} from './dto/rating-goal.types'

const PACE_KEYS: readonly PaceKey[] = ['steady', 'faster', 'push']
/** The pace a plan recommends: Faster. */
const RECOMMENDED_PACE: PaceKey = 'faster'

const neededView = (needed: ReviewsNeeded): number | null =>
  needed === 'unreachable' ? null : needed

const tenthsToRating = (tenths: number): number => tenths / 10

/** Google's numbers and the evidence for a quality, from the setup read's inputs. */
export function planningBasis(inputs: RatingGoalForecastInputs): PlanningBasis {
  const best = inputs.bestYear
  return {
    reviewCount: inputs.reviewCount,
    displayedTenths: inputs.displayedTenths,
    exact: ratio(inputs.exact.num, inputs.exact.den),
    evidence: {
      recentMix: ratio(inputs.mix.num, inputs.mix.den),
      bestYear:
        best === null
          ? null
          : {
              year: best.year,
              average: ratio(best.average.num, best.average.den),
              reviewCount: best.reviewCount,
            },
    },
  }
}

export const paceViewOf = (perWeek: number): RatingPaceView => ({
  perWeek,
  perMonth: perMonth(perWeek),
  perDay: perDay(perWeek),
})

/** When a target is expected at a planned quality and a weekly pace. */
export function planForecast(
  inputs: RatingGoalForecastInputs,
  targetTenths: number,
  qualityTenths: number,
  pacePerWeek: number,
): RatingForecast {
  return forecastArrival({
    reviewCount: inputs.reviewCount,
    exact: ratio(inputs.exact.num, inputs.exact.den),
    thresholdThousandths: thresholdThousandths(targetTenths),
    mix: ratio(qualityTenths, 10),
    pacePerWeek: ratio(pacePerWeek, 1),
    now: new Date(inputs.asOf),
    timezone: inputs.timezone,
  })
}

/** Every target from the next tenth to 4.9, each at its own recommended quality. */
export function ratingGoalStops(inputs: RatingGoalForecastInputs): RatingStopView[] {
  const paces = paceSuggestions(inputs.reviewsLast28Days)
  return ratingStops(planningBasis(inputs), paces.faster).map((stop): RatingStopView => ({
    targetTenths: stop.targetTenths,
    target: tenthsToRating(stop.targetTenths),
    qualityTenths: stop.qualityTenths,
    quality: tenthsToRating(stop.qualityTenths),
    qualityAnchor: stop.qualityAnchor,
    reviewsNeeded: neededView(stop.reviewsNeeded),
    bestCase: neededView(stop.bestCase),
    label: stop.label,
    forecasts: Object.fromEntries(
      PACE_KEYS.map((key) => [
        key,
        planForecast(inputs, stop.targetTenths, stop.qualityTenths, paces[key]),
      ]),
    ) as RatingStopView['forecasts'],
  }))
}

function optionView(
  inputs: RatingGoalForecastInputs,
  targetTenths: number,
  anchor: QualityAnchor,
  recommended: QualityAnchor,
): RatingQualityOptionView {
  return {
    kind: anchor.kind,
    qualityTenths: anchor.qualityTenths,
    quality: tenthsToRating(anchor.qualityTenths),
    year: anchor.year,
    recommended: anchor.qualityTenths === recommended.qualityTenths,
    reviewsNeeded: neededView(
      planNeeds(planningBasis(inputs), targetTenths, anchor.qualityTenths).reviewsNeeded,
    ),
  }
}

/** The quality row of one target ("New reviews will average"), each option with its cost. */
export function ratingGoalQualityChoice(
  inputs: RatingGoalForecastInputs,
  targetTenths: number,
): RatingQualityChoiceView {
  const choice = qualityChoice(planningBasis(inputs).evidence, targetTenths)
  const view = (anchor: QualityAnchor) =>
    optionView(inputs, targetTenths, anchor, choice.recommended)
  return {
    targetTenths,
    minimumTenths: choice.minimumTenths,
    options: choice.options.map(view),
    recommended: view(choice.recommended),
  }
}

function planView(inputs: RatingGoalForecastInputs, plan: RatingPlan): RatingPlanView {
  const needs = planNeeds(planningBasis(inputs), plan.targetTenths, plan.qualityTenths)
  return {
    key: plan.key,
    targetTenths: plan.targetTenths,
    target: tenthsToRating(plan.targetTenths),
    qualityTenths: plan.qualityTenths,
    quality: tenthsToRating(plan.qualityTenths),
    paceKey: plan.paceKey,
    pace: paceViewOf(plan.pacePerWeek),
    reviewsNeeded: neededView(needs.reviewsNeeded),
    bestCase: neededView(needs.bestCase),
    forecast: planForecast(
      inputs,
      plan.targetTenths,
      plan.qualityTenths,
      plan.pacePerWeek,
    ),
    reach: stopLabel(needs.reviewsNeeded, plan.pacePerWeek),
  }
}

/** The recommended target and every stop it was chosen from; null when no tenth is above. */
function recommendation(
  inputs: RatingGoalForecastInputs,
): Readonly<{ targetTenths: number; stops: readonly RatingStop[] }> | null {
  if (offerKeepFirst(inputs.displayedTenths)) return null
  const paces = paceSuggestions(inputs.reviewsLast28Days)
  const stops = ratingStops(planningBasis(inputs), paces.faster)
  const targetTenths = recommendedTarget(inputs.displayedTenths, stops)
  return targetTenths === null ? null : { targetTenths, stops }
}

function plansAt(
  inputs: RatingGoalForecastInputs,
  recommendedTenths: number,
  qualityTenths: number,
): RatingPlanView[] {
  return ratingPlans({
    numbers: planningBasis(inputs),
    recommendedTenths,
    qualityTenths,
    paces: paceSuggestions(inputs.reviewsLast28Days),
  }).map((plan) => planView(inputs, plan))
}

/**
 * The three plans at another shared quality ("Change"), or null when the
 * quality does not clear the recommended target's floor (or nothing can be
 * planned: Google shows 4.9 or 5.0).
 */
export function ratingGoalPlansAt(
  inputs: RatingGoalForecastInputs,
  qualityTenths: number,
): readonly RatingPlanView[] | null {
  const recommended = recommendation(inputs)
  if (recommended === null) return null
  if (qualityProblem(recommended.targetTenths, qualityTenths) !== null) return null
  return plansAt(inputs, recommended.targetTenths, qualityTenths)
}

/** "Pick a plan", or null when Google shows 4.9 or 5.0 (Keep is offered instead). */
export function ratingGoalPlanning(
  inputs: RatingGoalForecastInputs,
): RatingGoalPlanningView | null {
  const recommended = recommendation(inputs)
  if (recommended === null) return null
  const { targetTenths, stops } = recommended
  const quality = ratingGoalQualityChoice(inputs, targetTenths)
  const targets = targetRow(inputs.displayedTenths, targetTenths).map(
    (tenths): RatingTargetOptionView => ({
      targetTenths: tenths,
      target: tenthsToRating(tenths),
      label: stops.find((stop) => stop.targetTenths === tenths)?.label ?? 'out_of_reach',
      recommended: tenths === targetTenths,
    }),
  )
  return {
    recommendedTargetTenths: targetTenths,
    quality,
    plans: plansAt(inputs, targetTenths, quality.recommended.qualityTenths),
    targets,
    recommendedPaceKey: RECOMMENDED_PACE,
  }
}
