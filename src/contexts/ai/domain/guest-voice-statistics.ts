// v2: a change is judged against the Property's own previous 12 months with both
// shares uncertain (v1 took the baseline's observed rate as exact, and flagged an
// unchanged topic in 11% to 19% of the windows).
export const GUEST_VOICE_STATISTICS_VERSION = 'guest-voice-statistics-v2' as const
export const PERCENT_MIN_REVIEWS = 20 as const
/**
 * Analysed text reviews the 12 months before a window must hold before a change
 * is claimed against them: fewer, and the usual ups and downs of the share are not
 * known.
 */
export const CHANGE_BASELINE_MIN_REVIEWS = 20 as const
/** Analysed text reviews the window itself must hold before a change is claimed. */
const CHANGE_WINDOW_MIN_REVIEWS = 10

type EvidenceWindow = '30d' | '90d' | '180d' | '365d'

type EvidenceWindowChoice = Readonly<{
  window: EvidenceWindow
  enough: boolean
}>

type LikelyChange = 'rising' | 'falling' | 'steady' | 'unknown'
type EvidenceLevel = 'not_enough' | 'early' | 'likely'

type StarsWhenMentionedResult = Readonly<{
  mentionedAverage: number | null
  othersAverage: number | null
  gap: number | null
  upTo: number | null
}>

const EVIDENCE_WINDOWS: ReadonlyArray<EvidenceWindow> = ['30d', '90d', '180d', '365d']

const LANCZOS_COEFFICIENTS = [
  0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531,
  -176.6150291621406, 12.507343278686905, -0.13857109526572012, 9.984369578019572e-6,
  1.5056327351493116e-7,
] as const

const LANCZOS_G = 7
const CONTINUED_FRACTION_EPSILON = 3e-14
const CONTINUED_FRACTION_MINIMUM = 1e-300
const CONTINUED_FRACTION_MAX_ITERATIONS = 200

function logGamma(value: number): number {
  if (value < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value)
  }

  const shifted = value - 1
  let series = LANCZOS_COEFFICIENTS[0]
  for (let index = 1; index < LANCZOS_COEFFICIENTS.length; index += 1) {
    series += LANCZOS_COEFFICIENTS[index]! / (shifted + index)
  }
  const base = shifted + LANCZOS_G + 0.5

  return (
    0.5 * Math.log(2 * Math.PI) +
    (shifted + 0.5) * Math.log(base) -
    base +
    Math.log(series)
  )
}

function nonzeroFractionTerm(value: number): number {
  return Math.abs(value) < CONTINUED_FRACTION_MINIMUM ? CONTINUED_FRACTION_MINIMUM : value
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const sum = a + b
  const aPlusOne = a + 1
  const aMinusOne = a - 1
  let c = 1
  let d = 1 / nonzeroFractionTerm(1 - (sum * x) / aPlusOne)
  let fraction = d

  for (
    let iteration = 1;
    iteration <= CONTINUED_FRACTION_MAX_ITERATIONS;
    iteration += 1
  ) {
    const doubledIteration = 2 * iteration
    let coefficient =
      (iteration * (b - iteration) * x) /
      ((aMinusOne + doubledIteration) * (a + doubledIteration))
    d = 1 / nonzeroFractionTerm(1 + coefficient * d)
    c = nonzeroFractionTerm(1 + coefficient / c)
    fraction *= d * c

    coefficient =
      (-(a + iteration) * (sum + iteration) * x) /
      ((a + doubledIteration) * (aPlusOne + doubledIteration))
    d = 1 / nonzeroFractionTerm(1 + coefficient * d)
    c = nonzeroFractionTerm(1 + coefficient / c)
    const delta = d * c
    fraction *= delta

    if (Math.abs(delta - 1) < CONTINUED_FRACTION_EPSILON) return fraction
  }

  // Valid product inputs converge well before the guard; returning the best
  // approximation keeps the helper total for extreme but valid parameters.
  return fraction
}

/**
 * Computes the regularised incomplete beta without numerical integration.
 * The symmetry branch keeps the continued fraction in its stable region.
 */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    x < 0 ||
    x > 1 ||
    a <= 0 ||
    b <= 0
  ) {
    throw new RangeError('x must be in [0, 1], and a and b must be positive')
  }
  if (x === 0 || x === 1) return x

  const scale = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x),
  )

  if (x > (a + 1) / (a + b + 2)) {
    return 1 - (scale * betaContinuedFraction(1 - x, b, a)) / b
  }
  return (scale * betaContinuedFraction(x, a, b)) / a
}

export function chooseEvidenceWindow(
  textReviewCounts: Readonly<Record<EvidenceWindow, number>>,
  target = 60,
): EvidenceWindowChoice {
  // Window order is the policy: stop as soon as the requested evidence fits.
  const window =
    EVIDENCE_WINDOWS.find((candidate) => textReviewCounts[candidate] >= target) ?? '365d'

  return { window, enough: textReviewCounts['365d'] >= 10 }
}

export function baselineRate(baselineMentions: number, baselineReviews: number): number {
  return (baselineMentions + 0.5) / (baselineReviews + 1)
}

type ShareCounts = Readonly<{ successes: number; trials: number }>

function isShareCounts({ successes, trials }: ShareCounts): boolean {
  return (
    Number.isInteger(successes) &&
    Number.isInteger(trials) &&
    successes >= 0 &&
    successes <= trials
  )
}

/**
 * The chance that the share behind `current` is higher than the share behind
 * `baseline`, each known only from its counts.
 *
 * Each true share starts flat, Beta(1, 1), so `successes` of `trials` leaves it
 * Beta(successes + 1, trials - successes + 1). With whole-number shapes the chance
 * that one such share beats another is a finite sum (Evan Miller, "Formulas for
 * Bayesian A/B Testing"):
 *
 *   P(X > Y) = sum over i = 0 .. aX - 1 of
 *     B(aY + i, bY + bX) / ((bX + i) * B(1 + i, bX) * B(aY, bY))
 *
 * Its terms follow each other by a ratio of two fractions, so the sum is one pass.
 * The terms are kept as logarithms and added from the largest, because the first
 * one alone is smaller than a double for hundreds of reviews even where the whole
 * sum is nearly 1.
 */
export function probabilityShareHigher(
  current: ShareCounts,
  baseline: ShareCounts,
): number {
  if (!isShareCounts(current) || !isShareCounts(baseline)) {
    throw new RangeError('successes must be a whole number from 0 to trials')
  }
  const aX = current.successes + 1
  const bX = current.trials - current.successes + 1
  const aY = baseline.successes + 1
  const bY = baseline.trials - baseline.successes + 1

  let logTerm =
    logGamma(bY + bX) + logGamma(aY + bY) - logGamma(aY + bY + bX) - logGamma(bY)
  const logTerms: number[] = []
  let largest = logTerm
  for (let i = 0; i < aX; i += 1) {
    logTerms.push(logTerm)
    largest = Math.max(largest, logTerm)
    logTerm += Math.log((aY + i) / (aY + bY + bX + i)) + Math.log((bX + i) / (1 + i))
  }
  const scaledSum = logTerms.reduce((sum, term) => sum + Math.exp(term - largest), 0)

  return Math.min(1, Math.exp(largest) * scaledSum)
}

/**
 * Whether the share of reviews that name a topic moved against the Property's own
 * previous 12 months: `mentions` of `textReviews` in the window, `baselineMentions`
 * of `baselineReviews` in the 12 months that end where it starts.
 *
 * Both shares are uncertain, so they are compared as two posteriors
 * (`probabilityShareHigher`). `threshold` is the central range of the difference
 * between the two shares that must leave zero out: at 0.95 a rise is called when
 * the chance that the share went up is at least 0.975, and a fall when the chance
 * that it went down is, so each direction has a tail of 2.5% and an unchanged
 * topic is flagged in at most about 5% of the windows. (v1 set a prior on the
 * window's share at the baseline's observed rate and took that rate as exact. It
 * flagged an unchanged topic in 11% to 19% of the windows, by exact enumeration
 * over both binomials at 20 and 60 reviews, and still 9% to 10% at 60 once the bar
 * was raised to 0.95.)
 *
 * The share must also have moved by `margin` and rest on 3 reviews, so a
 * confident but immaterial move does not become a trend. Without a baseline of
 * `CHANGE_BASELINE_MIN_REVIEWS` there is nothing to be unusual against: unknown.
 */
export function likelyChange({
  mentions,
  textReviews,
  baselineMentions,
  baselineReviews,
  margin = 0.05,
  threshold = 0.95,
}: Readonly<{
  mentions: number
  textReviews: number
  baselineMentions: number
  baselineReviews: number
  margin?: number
  threshold?: number
}>): LikelyChange {
  const current = { successes: mentions, trials: textReviews }
  const baselineCounts = { successes: baselineMentions, trials: baselineReviews }
  if (
    textReviews < CHANGE_WINDOW_MIN_REVIEWS ||
    baselineReviews < CHANGE_BASELINE_MIN_REVIEWS ||
    !isShareCounts(current) ||
    !isShareCounts(baselineCounts)
  ) {
    return 'unknown'
  }

  const baseline = baselineRate(baselineMentions, baselineReviews)
  const currentRate = mentions / textReviews
  const needed = (1 + threshold) / 2
  const higher = probabilityShareHigher(current, baselineCounts)

  if (mentions >= 3 && currentRate >= baseline + margin && higher >= needed) {
    return 'rising'
  }
  if (baselineMentions >= 3 && currentRate <= baseline - margin && 1 - higher >= needed) {
    return 'falling'
  }
  return 'steady'
}

export function evidenceLevel({
  mentions,
  textReviews,
  change,
}: Readonly<{
  mentions: number
  textReviews: number
  change: LikelyChange
}>): EvidenceLevel {
  if (mentions < 3 || textReviews < 10) return 'not_enough'
  if (
    mentions >= 4 &&
    textReviews >= 20 &&
    (change === 'rising' || change === 'falling')
  ) {
    return 'likely'
  }
  return 'early'
}

function clampRating(rating: number): number {
  return Math.min(5, Math.max(1, rating))
}

function averageRatings(ratings: readonly number[]): number | null {
  if (ratings.length === 0) return null
  const total = ratings.reduce((sum, rating) => sum + clampRating(rating), 0)
  return total / ratings.length
}

function roundToNearestFiveHundredths(value: number): number {
  return Math.round(value * 20) / 20
}

export function starsWhenMentioned({
  mentionedRatings,
  otherRatings,
  allReviewsInWindow,
}: Readonly<{
  mentionedRatings: readonly number[]
  otherRatings: readonly number[]
  allReviewsInWindow: number
}>): StarsWhenMentionedResult {
  const mentionedAverage = averageRatings(mentionedRatings)
  const othersAverage = averageRatings(otherRatings)
  if (mentionedAverage === null || othersAverage === null) {
    return { mentionedAverage, othersAverage, gap: null, upTo: null }
  }

  const gap = othersAverage - mentionedAverage
  if (mentionedRatings.length < 3) {
    return { mentionedAverage, othersAverage, gap, upTo: null }
  }

  // Only the positive rating gap is recoverable upside; prevalence scales it
  // back to the whole evidence window before display rounding.
  const weightedGap = (mentionedRatings.length / allReviewsInWindow) * Math.max(0, gap)
  return {
    mentionedAverage,
    othersAverage,
    gap,
    upTo: roundToNearestFiveHundredths(weightedGap),
  }
}

export function shareText(mentions: number, textReviews: number): string {
  return `${mentions} of ${textReviews}`
}
