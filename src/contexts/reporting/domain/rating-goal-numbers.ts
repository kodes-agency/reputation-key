// Property Google rating goal — the number rules (pure, exact).
//
// A rating goal aims at the one-decimal number Google shows. Google rounds its
// average half up, so a target tenth starts five hundredths below it: 4.5
// shows from 4.45. Every comparison that decides a count of reviews runs on
// exact rationals (BigInt numerator over denominator), never on floats: a
// float subtraction such as 4.45 − 4.35 lands a hair above 0.1 and would ask
// for one review too many.
//
// Google's own average arrives already rounded to one decimal and stored as a
// float32 artefact (3.9000000953674316 for 3.9), so it is read to the nearest
// millionth first: a float32 near 5 is off by at most 2.4e-7, so this strips
// the artefact and nothing a finer figure carries (4.4496 still shows 4.4).
// It never carries the exact average: that comes from the review cache when
// the cache holds every review Google counts (ADR 0067).

/** Google rounds its one-decimal number half up: 4.45 shows as 4.5. */
export const GOOGLE_DISPLAY_ROUNDING = 'half_up' as const

/** Where a shown tenth starts below it, in thousandths: 4.5 starts at 4.45. */
const DISPLAY_THRESHOLD_OFFSET_THOUSANDTHS = 50

/** Average stars of the reviews created in this many days is the recent mix. */
export const RECENT_MIX_WINDOW_DAYS = 90
/** The window is used only when it holds at least this many reviews. */
const RECENT_MIX_MINIMUM_REVIEWS = 10
/** Otherwise the mix is the average of this many most recent reviews. */
export const RECENT_MIX_FALLBACK_REVIEWS = 25

/** A non-negative exact number: `num / den`, `den` > 0, in lowest terms. */
export type Ratio = Readonly<{ num: bigint; den: bigint }>

/** A count of ratings and the sum of their stars. */
export type RatingTotals = Readonly<{ count: number; sum: number }>

export type ExactAverage = Readonly<{
  value: Ratio
  /** `cache` when the cache holds every Google review; `google` otherwise. */
  source: 'cache' | 'google'
}>

export type RecentMix = Readonly<{
  value: Ratio
  reviewCount: number
  basis: 'last_90_days' | 'most_recent'
}>

/** A count of reviews, or `unreachable` when no count gets there. */
export type ReviewsNeeded = number | 'unreachable'

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b))

/** The exact ratio `num / den` in lowest terms. */
export function ratio(num: number | bigint, den: number | bigint): Ratio {
  const n = BigInt(num)
  const d = BigInt(den)
  if (d <= 0n) throw new RangeError('A ratio needs a positive denominator')
  const divisor = gcd(n < 0n ? -n : n, d) || 1n
  return { num: n / divisor, den: d / divisor }
}

/** round(numerator / denominator), half up, for non-negative integers. */
export const roundHalfUpInt = (numerator: number, denominator: number): number =>
  Math.floor((2 * numerator + denominator) / (2 * denominator))

export const ratioToNumber = (value: Ratio): number =>
  Number(value.num) / Number(value.den)

/** Five stars: the best mix there is. */
export const FIVE_STARS: Ratio = ratio(5, 1)

/** The ratio of a value given in thousandths. */
export const fromThousandths = (thousandths: number): Ratio => ratio(thousandths, 1000)

/** `left - right` as an unreduced pair (numerator, denominator). */
const difference = (
  left: Ratio,
  right: Ratio,
): Readonly<{ num: bigint; den: bigint }> => ({
  num: left.num * right.den - right.num * left.den,
  den: left.den * right.den,
})

/** Shift a ratio by a signed number of thousandths. */
export function shiftByThousandths(value: Ratio, thousandths: number): Ratio {
  return ratio(value.num * 1000n + BigInt(thousandths) * value.den, value.den * 1000n)
}

/** Compare two ratios: negative, zero or positive. */
export function compareRatios(left: Ratio, right: Ratio): number {
  const delta = difference(left, right).num
  return delta === 0n ? 0 : delta < 0n ? -1 : 1
}

const MILLION = 1_000_000

/** A value to the nearest millionth, which strips Google's float32 artefact. */
const millionthsOf = (value: number): number => Math.round(value * MILLION)

/** The tenth Google shows for its average (45 = 4.5), rounded half up. */
export function displayedTenths(googleAverage: number): number {
  return Math.floor(
    (millionthsOf(googleAverage) + DISPLAY_THRESHOLD_OFFSET_THOUSANDTHS * 1000) /
      (MILLION / 10),
  )
}

/** The exact average at which Google starts showing a tenth, in thousandths. */
export const thresholdThousandths = (targetTenths: number): number =>
  targetTenths * 100 - DISPLAY_THRESHOLD_OFFSET_THOUSANDTHS

/**
 * The average a goal plans against: the cache's sum over count when the cache
 * holds every review Google counts, otherwise Google's own figure. Null when
 * neither has a rating.
 */
export function exactAverage(
  cache: RatingTotals,
  google: Readonly<{ reviewCount: number; averageRating: number | null }>,
): ExactAverage | null {
  if (cache.count > 0 && cache.count === google.reviewCount) {
    return { value: ratio(cache.sum, cache.count), source: 'cache' }
  }
  if (google.averageRating === null || google.reviewCount === 0) return null
  return { value: ratio(millionthsOf(google.averageRating), MILLION), source: 'google' }
}

/**
 * The stars new reviews are likely to bring: the last 90 days when they hold
 * at least ten reviews, otherwise the most recent 25 (or all, when fewer).
 */
export function recentMix(
  window: RatingTotals,
  mostRecent: RatingTotals,
): RecentMix | null {
  if (window.count >= RECENT_MIX_MINIMUM_REVIEWS) {
    return {
      value: ratio(window.sum, window.count),
      reviewCount: window.count,
      basis: 'last_90_days',
    }
  }
  if (mostRecent.count === 0) return null
  return {
    value: ratio(mostRecent.sum, mostRecent.count),
    reviewCount: mostRecent.count,
    basis: 'most_recent',
  }
}

export type ReviewsNeededInput = Readonly<{
  /** Google's review count. */
  reviewCount: number
  exact: Ratio
  thresholdThousandths: number
  /** Average stars of the reviews still to come. */
  mix: Ratio
}>

/**
 * ceil(N × (θ − E) / (m − θ)): the reviews at mix m that lift N reviews at
 * exact average E to the threshold θ. None when E already meets θ;
 * unreachable when m does not exceed θ.
 */
export function reviewsNeeded(input: ReviewsNeededInput): ReviewsNeeded {
  const threshold = fromThousandths(input.thresholdThousandths)
  const gap = difference(threshold, input.exact)
  if (gap.num <= 0n) return 0
  const lift = difference(input.mix, threshold)
  if (lift.num <= 0n) return 'unreachable'
  const numerator = BigInt(input.reviewCount) * gap.num * lift.den
  const denominator = gap.den * lift.num
  return Number((numerator + denominator - 1n) / denominator)
}

/** Reviews needed if every new review is five stars. */
export function bestCaseReviewsNeeded(
  input: Omit<ReviewsNeededInput, 'mix'>,
): ReviewsNeeded {
  return reviewsNeeded({ ...input, mix: FIVE_STARS })
}
