// Property Google rating goal — when a target is expected (pure).
//
// There is no deadline: a goal shows a forecast month range that moves with
// the numbers. The range allows for drift in both inputs. Its early end is the
// mix 0.1★ better and the pace 10% faster; its late end the mix 0.1★ worse
// and the pace 10% slower. When the worse mix no longer clears the threshold
// the late end is open. Months are named in the Property's time zone, counted
// from an injected `now` (ADR 0017).

import { propertyWallClockAt } from '#/shared/domain/property-calendar'
import {
  compareRatios,
  fromThousandths,
  ratioToNumber,
  reviewsNeeded,
  shiftByThousandths,
  type Ratio,
} from './rating-goal-numbers'

/** The forecast allows the recent mix to drift this far either way (0.1★). */
export const FORECAST_MIX_DRIFT_THOUSANDTHS = 100
/** The forecast allows the pace to drift this far either way. */
export const FORECAST_PACE_DRIFT_PERCENT = 10
/** Nothing is forecast further out than ten years. */
export const FORECAST_HORIZON_WEEKS = 520

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export type RatingForecast =
  /** The recent mix does not clear the threshold: no pace reaches it. */
  | Readonly<{ kind: 'unreachable' }>
  /** The pace is zero. */
  | Readonly<{ kind: 'no_pace' }>
  /** Even the early end is more than ten years away. */
  | Readonly<{ kind: 'beyond_horizon' }>
  /** `YYYY-MM` months; `toMonth` is null when the late end is open. */
  | Readonly<{ kind: 'range'; fromMonth: string; toMonth: string | null }>

export type ForecastInput = Readonly<{
  reviewCount: number
  exact: Ratio
  thresholdThousandths: number
  mix: Ratio
  pacePerWeek: Ratio
  now: Date
  timezone: string
}>

/** The Property-local month (`YYYY-MM`) of an instant. */
export function monthKeyAt(instant: Date, timezone: string): string {
  const local = propertyWallClockAt(instant, timezone)
  return `${local.year}-${String(local.month).padStart(2, '0')}`
}

/** Weeks to gather a count of reviews at a weekly pace. */
export function weeksToReach(reviews: number, pacePerWeek: Ratio): number {
  if (reviews === 0) return 0
  if (pacePerWeek.num === 0n) return Number.POSITIVE_INFINITY
  return ratioToNumber({
    num: BigInt(reviews) * pacePerWeek.den,
    den: pacePerWeek.num,
  })
}

/** A pace scaled by (100 + percent) / 100. */
const scalePace = (pace: Ratio, percent: number): Ratio => ({
  num: pace.num * BigInt(100 + percent),
  den: pace.den * 100n,
})

const monthAfterWeeks = (input: ForecastInput, weeks: number): string =>
  monthKeyAt(new Date(input.now.getTime() + Math.round(weeks * WEEK_MS)), input.timezone)

/** Weeks to the threshold at a given mix and pace, or null when the mix never gets there. */
function weeksAt(input: ForecastInput, mix: Ratio, pace: Ratio): number | null {
  const needed = reviewsNeeded({ ...input, mix })
  return needed === 'unreachable' ? null : weeksToReach(needed, pace)
}

/** The month range a target is expected in at a weekly pace. */
export function forecastArrival(input: ForecastInput): RatingForecast {
  if (input.pacePerWeek.num === 0n) return { kind: 'no_pace' }
  const threshold = fromThousandths(input.thresholdThousandths)
  if (compareRatios(input.mix, threshold) <= 0) return { kind: 'unreachable' }

  const early = weeksAt(
    input,
    shiftByThousandths(input.mix, FORECAST_MIX_DRIFT_THOUSANDTHS),
    scalePace(input.pacePerWeek, FORECAST_PACE_DRIFT_PERCENT),
  )
  if (early === null || early > FORECAST_HORIZON_WEEKS) return { kind: 'beyond_horizon' }

  const late = weeksAt(
    input,
    shiftByThousandths(input.mix, -FORECAST_MIX_DRIFT_THOUSANDTHS),
    scalePace(input.pacePerWeek, -FORECAST_PACE_DRIFT_PERCENT),
  )
  return {
    kind: 'range',
    fromMonth: monthAfterWeeks(input, early),
    toMonth:
      late === null || late > FORECAST_HORIZON_WEEKS
        ? null
        : monthAfterWeeks(input, late),
  }
}
