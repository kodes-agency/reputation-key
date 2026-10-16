// Property Google rating goal — the climb the detail page draws (pure, exact).
//
// Round 5 (2026-10-16, PLAN-D D-2): the detail's chart shows where the exact
// average went (Review's week-end averages), the plan as a cone from the latest
// plan change (else the set), and the likely band from today. A path is the
// average after n more reviews at an average m: (E·N + n·m) / (N + n), with n
// the reviews a pace brings in a number of days. Every point is worked out in
// BigInt rationals and handed on in thousandths, half up, so the page does no
// maths (D15).
//
// The cone's edges are the plan's average 0.1★ better (never above five stars)
// at a pace 10% faster, and 0.1★ worse at 10% slower; the band's are the same
// drift around the average the goal now assumes, at the pace its arrival uses,
// so the band and the arrival sentence cannot disagree (E16). Both stop rising
// at the goal's threshold: once Google shows the goal there is nothing to draw.

import {
  FORECAST_MIX_DRIFT_THOUSANDTHS,
  FORECAST_PACE_DRIFT_PERCENT,
} from './rating-goal-forecast'
import { chosenRate, type DayFraction, type PaceRate } from './rating-goal-arrival'
import {
  compareRatios,
  FIVE_STARS,
  ratio,
  roundHalfUpInt,
  shiftByThousandths,
  thresholdThousandths,
  type Ratio,
} from './rating-goal-numbers'
import type { RatingGoalChangeField } from './rating-goal'

/** Where a path starts: Google's count, the exact average, and the day (0 is today). */
export type ClimbStart = Readonly<{ reviewCount: number; exact: Ratio; day: number }>

/** One week of a cone or band, in thousandths of a star. */
export type BandPoint = Readonly<{ day: number; low: number; high: number }>

/** A cone and a band are sampled once a week. */
const STEP_DAYS = 7
/** They run at least half a year ahead, and at most a year. */
const MIN_HORIZON_DAYS = 182
const MAX_HORIZON_DAYS = 365
const PERCENT = 100
/** Days in a month, in tenths (30.4), over the 28 days a count covers. */
const MONTH_TENTH_DAYS = 304
const TENTH_DAYS_IN_FOUR_WEEKS = 280

/** (E·N + n·m) / (N + n): the average after n more reviews at an average m. */
export function averageAfter(
  reviewCount: number,
  exact: Ratio,
  added: Ratio,
  mix: Ratio,
): Ratio {
  const count = BigInt(reviewCount)
  const num = exact.num * count * added.den * mix.den + added.num * mix.num * exact.den
  const den = exact.den * mix.den * (count * added.den + added.num)
  return ratio(num, den)
}

const thousandthsOf = (value: Ratio): number =>
  Number((2n * value.num * 1000n + value.den) / (2n * value.den))

/** The reviews a pace scaled by `percent` / 100 brings in `days`. */
const reviewsIn = (rate: PaceRate, percent: number, days: number): Ratio =>
  ratio(BigInt(rate.reviews) * BigInt(percent) * BigInt(days), rate.perDays * PERCENT)

type Edge = Readonly<{ mix: Ratio; percent: number }>

/** One edge of a cone or band on `day`, at most `capThousandths`. */
function edgeAt(start: ClimbStart, edge: Edge, rate: PaceRate, day: number, cap: number) {
  const added = reviewsIn(rate, edge.percent, day - start.day)
  return Math.min(
    cap,
    thousandthsOf(averageAfter(start.reviewCount, start.exact, added, edge.mix)),
  )
}

/** The better and worse edges around an average: 0.1★ and 10% each way. */
function edgesAround(mix: Ratio): Readonly<{ high: Edge; low: Edge }> {
  const better = shiftByThousandths(mix, FORECAST_MIX_DRIFT_THOUSANDTHS)
  return {
    high: {
      mix: compareRatios(better, FIVE_STARS) > 0 ? FIVE_STARS : better,
      percent: PERCENT + FORECAST_PACE_DRIFT_PERCENT,
    },
    low: {
      mix: shiftByThousandths(mix, -FORECAST_MIX_DRIFT_THOUSANDTHS),
      percent: PERCENT - FORECAST_PACE_DRIFT_PERCENT,
    },
  }
}

/** Every week from the start to `horizon` days after it, and the last day itself. */
function sampleDays(fromDay: number, horizon: number): readonly number[] {
  const weeks = Array.from(
    { length: Math.floor(horizon / STEP_DAYS) + 1 },
    (_, week) => fromDay + week * STEP_DAYS,
  )
  const last = fromDay + horizon
  return weeks.at(-1) === last ? weeks : [...weeks, last]
}

function band(
  start: ClimbStart,
  mix: Ratio,
  rate: PaceRate,
  targetTenths: number,
  horizon: number,
  firstDay: number,
): readonly BandPoint[] {
  const cap = thresholdThousandths(targetTenths)
  const { high, low } = edgesAround(mix)
  return sampleDays(start.day, horizon)
    .filter((day) => day >= firstDay)
    .map((day) => ({
      day,
      low: edgeAt(start, low, rate, day, cap),
      high: edgeAt(start, high, rate, day, cap),
    }))
}

const clampHorizon = (days: number): number =>
  Math.min(MAX_HORIZON_DAYS, Math.max(MIN_HORIZON_DAYS, days))

export type PlanConeInput = Readonly<{
  /** The set (the stored baseline) or the latest plan change (the week before it ended there). */
  start: ClimbStart
  qualityTenths: number
  paceTenthsPerWeek: number
  targetTenths: number
  /** The chart's first day: earlier points are left out. */
  firstDay: number
}>

/**
 * The plan as a cone from its start (E15): weekly, at least half a year and at
 * least to today, a year at most; points before the chart starts left out.
 */
export function planCone(input: PlanConeInput): readonly BandPoint[] {
  return band(
    input.start,
    ratio(input.qualityTenths, 10),
    chosenRate(input.paceTenthsPerWeek),
    input.targetTenths,
    clampHorizon(-input.start.day),
    input.firstDay,
  )
}

export type LikelyBandInput = Readonly<{
  reviewCount: number
  exact: Ratio
  targetTenths: number
  /** The average the goal now assumes (its tracking mix). */
  mix: Ratio
  /** The pace its arrival uses. */
  rate: PaceRate
  /** The arrival's slow end; null when it is open. */
  slow: DayFraction | null
}>

/**
 * The likely band from today (E16): the arrival's own drift, weekly to its slow
 * end (a year when that is open), at least half a year, a year at most.
 */
export function likelyBand(input: LikelyBandInput): readonly BandPoint[] {
  const slowDays =
    input.slow === null ? MAX_HORIZON_DAYS : Math.ceil(input.slow.num / input.slow.den)
  return band(
    { reviewCount: input.reviewCount, exact: input.exact, day: 0 },
    input.mix,
    input.rate,
    input.targetTenths,
    clampHorizon(slowDays),
    0,
  )
}

/** Reviews in four weeks as a whole number a month (30.4 days), half up. */
export const perMonthOf28Days = (count: number): number =>
  roundHalfUpInt(count * MONTH_TENTH_DAYS, TENTH_DAYS_IN_FOUR_WEEKS)

/** A change log row as the first-per-field read returns it. */
export type FirstChange = Readonly<{
  field: RatingGoalChangeField
  oldValue: string | null
}>

export type InitialPlan = Readonly<{
  targetTenths: number
  paceTenthsPerWeek: number | null
}>

/** A logged value as a whole number; null as "none" or anything unreadable. */
const loggedNumber = (value: string | null): number | null =>
  value === null || !Number.isInteger(Number(value)) ? null : Number(value)

/**
 * What the goal was set with (E31): each field's oldest change's old value,
 * else the value it has now (that field never changed).
 */
export function initialPlan(
  current: InitialPlan,
  firstPerField: readonly FirstChange[],
): InitialPlan {
  const first = (field: RatingGoalChangeField) =>
    firstPerField.find((change) => change.field === field)
  const target = first('target')
  const pace = first('pace')
  return {
    targetTenths:
      target === undefined
        ? current.targetTenths
        : (loggedNumber(target.oldValue) ?? current.targetTenths),
    paceTenthsPerWeek:
      pace === undefined ? current.paceTenthsPerWeek : loggedNumber(pace.oldValue),
  }
}
