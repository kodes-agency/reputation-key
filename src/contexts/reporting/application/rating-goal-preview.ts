// Property Google rating goal — a pace the manager types in, worked out on
// the page (pure, no server code).
//
// The setup read returns every stop with its forecast at the three suggested
// paces, and the exact inputs it worked them out from (`forecastInputs`). A
// custom pace is worked out here from those inputs, with the same domain
// maths, so the page answers as the manager types.

import { ratio, thresholdThousandths } from '../domain/rating-goal-numbers'
import { forecastArrival } from '../domain/rating-goal-forecast'
import { perDay, perMonth, surgeCaution } from '../domain/rating-goal-pace'
import type {
  RatingGoalForecastInputs,
  RatingGoalPacePreview,
} from './dto/rating-goal.types'

export function previewRatingGoalPace(
  inputs: RatingGoalForecastInputs,
  targetTenths: number,
  pacePerWeek: number,
): RatingGoalPacePreview {
  return {
    pace: {
      perWeek: pacePerWeek,
      perMonth: perMonth(pacePerWeek),
      perDay: perDay(pacePerWeek),
    },
    forecast: forecastArrival({
      reviewCount: inputs.reviewCount,
      exact: ratio(inputs.exact.num, inputs.exact.den),
      mix: ratio(inputs.mix.num, inputs.mix.den),
      thresholdThousandths: thresholdThousandths(targetTenths),
      pacePerWeek: ratio(pacePerWeek, 1),
      now: new Date(inputs.asOf),
      timezone: inputs.timezone,
    }),
    surgeCaution: surgeCaution(pacePerWeek, inputs.reviewsLast28Days),
  }
}
