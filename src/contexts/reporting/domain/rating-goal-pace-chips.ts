// Property Google rating goal — the pace chips of the setup (pure, exact).
//
// Rounds 3 and 4 (2026-10-16, R3-1 and R3-3): the pace question is how many new
// reviews a day the Property will ask for, not a multiple of today's pace.
// The proven pace is the busier of the last 90 days and the busiest 30
// consecutive days of the last year, a day. The recommendation is the nice
// pace (1, 2, 3, 5, 7, 10, 15, 20, 30, 50 a day) nearest one and a half times
// the proven one, at least 1 a day (a tie goes to the higher, nothing above 50).
// A quiet Property (proven under 1 a day) is offered "A few a week", 1, 2, 3 and
// 5 a day; a busy one its busiest month, the recommendation and the three nice
// paces above it (the approved mock's five stops). A pace is stored in tenths
// of a review a week, so 1.5 a day (105), 0.2 a day (14) and 20 a month (46)
// all round-trip; a month is 30.4 days.

import { compareRatios, ratio, roundHalfUpInt, type Ratio } from './rating-goal-numbers'
import { MAX_PACE_TENTHS_PER_WEEK } from './rating-goal-pace'

/** "A few a week": three a week. */
export const A_FEW_A_WEEK_TENTHS = 30
/** The lowest pace a manager may type: 0.2 a day (1.4 a week). */
export const OWN_PACE_MIN_TENTHS = 14

/** The paces a day a recommendation may be. */
const NICE_PACES_PER_DAY = [1, 2, 3, 5, 7, 10, 15, 20, 30, 50] as const
/** The quiet chips after "A few a week", a day. */
const QUIET_PACES_PER_DAY = [1, 2, 3, 5] as const
/** Tenths of a review a week in one review a day. */
const TENTHS_A_WEEK_PER_DAY = 70
/** Days a month, in tenths (30.4). */
const DAYS_PER_MONTH_TENTHS = 304
/** The windows the proven pace is counted over. */
const LAST_DAYS = 90
const BUSIEST_DAYS = 30
/** The recommendation is one and a half times the proven pace. */
const STRETCH = ratio(3, 2)
/** A busy Property is offered this many nice paces above the recommendation. */
const CHIPS_ABOVE = 3

export type PaceChipKind = 'a_few_a_week' | 'busiest_month' | 'nice'
export type PaceChip = Readonly<{ kind: PaceChipKind; tenthsPerWeek: number }>
export type PaceChips = Readonly<{
  chips: readonly PaceChip[]
  recommendedIndex: number
  provenPerDay: Ratio
  busiest30: number
}>

const ONE = ratio(1, 1)
const larger = (left: Ratio, right: Ratio): Ratio =>
  compareRatios(left, right) >= 0 ? left : right

/** max(reviews in 90 days / 90, the busiest 30 days / 30), a day. */
export const provenPacePerDay = (reviewsLast90Days: number, busiest30: number): Ratio =>
  larger(ratio(reviewsLast90Days, LAST_DAYS), ratio(busiest30, BUSIEST_DAYS))

/** |value − n| as an exact ratio. */
const distance = (value: Ratio, n: number): Ratio => {
  const delta = value.num - BigInt(n) * value.den
  return ratio(delta < 0n ? -delta : delta, value.den)
}

/** The nice pace a day nearest max(1, 1.5 × proven); a tie goes up. */
function recommendedPacePerDay(proven: Ratio): number {
  const aim = larger(ONE, ratio(proven.num * STRETCH.num, proven.den * STRETCH.den))
  let best: number = NICE_PACES_PER_DAY[0]
  for (const pace of NICE_PACES_PER_DAY) {
    if (compareRatios(distance(aim, pace), distance(aim, best)) <= 0) best = pace
  }
  return best
}

const nice = (perDay: number): PaceChip => ({
  kind: 'nice',
  tenthsPerWeek: perDay * TENTHS_A_WEEK_PER_DAY,
})

/** The setup's five stops (fewer near 50 a day) and which one is recommended. */
export function paceChips(reviewsLast90Days: number, busiest30: number): PaceChips {
  const provenPerDay = provenPacePerDay(reviewsLast90Days, busiest30)
  const base = { provenPerDay, busiest30 }
  if (compareRatios(provenPerDay, ONE) < 0) {
    const chips = [
      { kind: 'a_few_a_week', tenthsPerWeek: A_FEW_A_WEEK_TENTHS } as const,
      ...QUIET_PACES_PER_DAY.map(nice),
    ]
    return { ...base, chips, recommendedIndex: 1 }
  }
  const recommended = recommendedPacePerDay(provenPerDay)
  const above = NICE_PACES_PER_DAY.filter((pace) => pace > recommended).slice(
    0,
    CHIPS_ABOVE,
  )
  const busiest = Math.min(
    MAX_PACE_TENTHS_PER_WEEK,
    roundHalfUpInt(busiest30 * TENTHS_A_WEEK_PER_DAY, BUSIEST_DAYS),
  )
  const rest = [nice(recommended), ...above.map(nice)]
  if (busiest >= recommended * TENTHS_A_WEEK_PER_DAY) {
    return { ...base, chips: rest, recommendedIndex: 0 }
  }
  const chips = [{ kind: 'busiest_month', tenthsPerWeek: busiest } as const, ...rest]
  return { ...base, chips, recommendedIndex: 1 }
}

/** A pace in tenths of a review a day, half up: 105 a week is 15 (1.5 a day). */
export const dayTenthsOf = (tenthsPerWeek: number): number =>
  roundHalfUpInt(tenthsPerWeek, 7)

/** x < 20 to the review, x < 100 to five, else to ten, half up; x = num / den. */
function nicePerMonth(num: number, den: number): number {
  if (num < 20 * den) return roundHalfUpInt(num, den)
  if (num < 100 * den) return 5 * roundHalfUpInt(num, 5 * den)
  return 10 * roundHalfUpInt(num, 10 * den)
}

/** A pace a week as a nice number a month: 70 tenths (1 a day) is 30. */
export const perMonthOf = (tenthsPerWeek: number): number =>
  nicePerMonth(tenthsPerWeek * DAYS_PER_MONTH_TENTHS, 10 * TENTHS_A_WEEK_PER_DAY)

/** Reviews of the last 90 days as a nice number a month ("about 2 a month now"). */
export const nowPerMonth = (reviewsLast90Days: number): number =>
  nicePerMonth(reviewsLast90Days * DAYS_PER_MONTH_TENTHS, 10 * LAST_DAYS)

/**
 * A typed pace in tenths a week, from 0.2 a day to 50 a day, and which end it
 * was clamped to. A day takes one decimal; a month a whole number. Nothing
 * readable is the lowest pace.
 */
export function ownPaceTenths(
  unit: 'day' | 'month',
  typed: number | null,
): Readonly<{ tenths: number; clamped: 'low' | 'high' | null }> {
  if (typed === null || !Number.isFinite(typed)) {
    return { tenths: OWN_PACE_MIN_TENTHS, clamped: 'low' }
  }
  const raw =
    unit === 'day'
      ? Math.round(Math.max(0, typed) * 10) * 7
      : roundHalfUpInt(
          Math.round(Math.max(0, typed)) * 10 * TENTHS_A_WEEK_PER_DAY,
          DAYS_PER_MONTH_TENTHS,
        )
  if (raw < OWN_PACE_MIN_TENTHS) return { tenths: OWN_PACE_MIN_TENTHS, clamped: 'low' }
  if (raw > MAX_PACE_TENTHS_PER_WEEK) {
    return { tenths: MAX_PACE_TENTHS_PER_WEEK, clamped: 'high' }
  }
  return { tenths: raw, clamped: null }
}
