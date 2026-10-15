// Property Google rating goal — the planned quality of new reviews (pure).
//
// A plan assumes the average stars new Google reviews will bring: its planned
// quality, a tenth of a star (round 2, 2026-10-15). The options a manager is
// offered come from evidence, never from arithmetic offsets:
//   like_now     the recent mix (rating-goal-numbers.ts), as a tenth
//   best_year    the best calendar year with at least ten reviews, as a tenth
//   step_above   a step above what the target needs: θ + 0.3, rounded up
//   excellent    4.8
// Averages become tenths half up. A planned quality must clear the target's
// threshold by 0.15★ or more, because reviews needed = gap / (quality − θ)
// explodes near the threshold (4.5★ against 4.45 asks for about five times the
// reviews 4.7★ does). An anchor below that floor is dropped, and a manager's
// own quality obeys it too. The recommendation is the first of like_now,
// best_year and step_above that clears the floor (step_above always does), and
// it sits between its nearest anchors below and above where there are some.

import {
  compareRatios,
  ratio,
  thresholdThousandths,
  type Ratio,
  type RatingTotals,
} from './rating-goal-numbers'
import { PERFECT_TENTHS } from './rating-goal-stops'

/** A planned quality clears the target's threshold by at least this much (0.15★). */
const QUALITY_MARGIN_THOUSANDTHS = 150
/** "A step above what {T} needs": the threshold plus 0.3★, rounded up to a tenth. */
const STEP_ABOVE_THOUSANDTHS = 300
/** "Excellent": 4.8★. */
export const EXCELLENT_QUALITY_TENTHS = 48
/** A calendar year counts as evidence with at least this many reviews. */
export const BEST_YEAR_MINIMUM_REVIEWS = 10
/** The quality cards offer at most this many options. */
const QUALITY_OPTION_COUNT = 3

export type QualityAnchorKind = 'like_now' | 'best_year' | 'step_above' | 'excellent'

/** Evidence order: when two anchors fall on one tenth, the earlier kind keeps it. */
const ANCHOR_PRIORITY: readonly QualityAnchorKind[] = [
  'like_now',
  'best_year',
  'step_above',
  'excellent',
]

/** The anchors a recommendation may be, in the order R2-3 tries them. */
const RECOMMENDATION_ORDER: readonly QualityAnchorKind[] = [
  'like_now',
  'best_year',
  'step_above',
]

/** One calendar year of reviews: its count and star sum. */
export type YearTotals = RatingTotals & Readonly<{ year: number }>

export type BestYear = Readonly<{ year: number; average: Ratio; reviewCount: number }>

export type QualityEvidence = Readonly<{
  /** The recent mix; null without a review. */
  recentMix: Ratio | null
  bestYear: BestYear | null
}>

export type QualityAnchor = Readonly<{
  kind: QualityAnchorKind
  qualityTenths: number
  /** The calendar year of `best_year`; null for every other kind. */
  year: number | null
}>

export type QualityChoice = Readonly<{
  /** Every anchor that clears the floor, one per tenth, lowest first. */
  anchors: readonly QualityAnchor[]
  recommended: QualityAnchor
  /** The recommendation between its nearest anchors below and above, lowest first. */
  options: readonly QualityAnchor[]
  /** The lowest quality a plan for this target may assume. */
  minimumTenths: number
}>

/** An average as a tenth, rounded half up, exactly: 4.46 is 45. */
export const nearestTenth = (value: Ratio): number =>
  Number((20n * value.num + value.den) / (2n * value.den))

/** A count of thousandths as a tenth, rounded up. */
const tenthAtOrAbove = (thousandths: number): number => Math.ceil(thousandths / 100)

/** The lowest planned quality for a target: its threshold + 0.15★, as a tenth. */
export const minimumQualityTenths = (targetTenths: number): number =>
  tenthAtOrAbove(thresholdThousandths(targetTenths) + QUALITY_MARGIN_THOUSANDTHS)

/** "A step above what {T} needs": θ + 0.3★ rounded up, never above five stars. */
export const stepAboveTenths = (targetTenths: number): number =>
  Math.min(
    PERFECT_TENTHS,
    tenthAtOrAbove(thresholdThousandths(targetTenths) + STEP_ABOVE_THOUSANDTHS),
  )

/** A climb goal's planned quality: a whole tenth from its floor to five stars. */
export function qualityProblem(
  targetTenths: number,
  qualityTenths: number,
): 'invalid_quality' | null {
  return Number.isInteger(qualityTenths) &&
    qualityTenths >= minimumQualityTenths(targetTenths) &&
    qualityTenths <= PERFECT_TENTHS
    ? null
    : 'invalid_quality'
}

/** The calendar year with the highest average among those with ten reviews; the later on a tie. */
export function bestYear(years: readonly YearTotals[]): BestYear | null {
  let best: BestYear | null = null
  for (const year of years) {
    if (year.count < BEST_YEAR_MINIMUM_REVIEWS) continue
    const average = ratio(year.sum, year.count)
    const order = best === null ? 1 : compareRatios(average, best.average)
    if (best === null || order > 0 || (order === 0 && year.year > best.year)) {
      best = { year: year.year, average, reviewCount: year.count }
    }
  }
  return best
}

/** Every candidate in evidence order, before the floor and the tenth they share. */
function candidates(evidence: QualityEvidence, targetTenths: number): QualityAnchor[] {
  const found: QualityAnchor[] = []
  if (evidence.recentMix !== null) {
    found.push({
      kind: 'like_now',
      qualityTenths: nearestTenth(evidence.recentMix),
      year: null,
    })
  }
  if (evidence.bestYear !== null) {
    found.push({
      kind: 'best_year',
      qualityTenths: nearestTenth(evidence.bestYear.average),
      year: evidence.bestYear.year,
    })
  }
  found.push(
    { kind: 'step_above', qualityTenths: stepAboveTenths(targetTenths), year: null },
    { kind: 'excellent', qualityTenths: EXCELLENT_QUALITY_TENTHS, year: null },
  )
  return found.sort(
    (left, right) =>
      ANCHOR_PRIORITY.indexOf(left.kind) - ANCHOR_PRIORITY.indexOf(right.kind),
  )
}

/** The anchors that clear the floor, one per tenth (the earlier kind keeps it), lowest first. */
function anchorsFor(evidence: QualityEvidence, targetTenths: number): QualityAnchor[] {
  const floor = minimumQualityTenths(targetTenths)
  const kept: QualityAnchor[] = []
  for (const anchor of candidates(evidence, targetTenths)) {
    const clears = anchor.qualityTenths >= floor && anchor.qualityTenths <= PERFECT_TENTHS
    const taken = kept.some((known) => known.qualityTenths === anchor.qualityTenths)
    if (clears && !taken) kept.push(anchor)
  }
  return kept.sort((left, right) => left.qualityTenths - right.qualityTenths)
}

/**
 * Three options around the recommendation: its nearest anchor below and
 * above, or two from one side when the other has none.
 */
function optionsAround(
  anchors: readonly QualityAnchor[],
  recommended: QualityAnchor,
): QualityAnchor[] {
  const at = anchors.indexOf(recommended)
  const others = QUALITY_OPTION_COUNT - 1
  const above = Math.min(anchors.length - at - 1, others - Math.min(at, 1))
  const below = Math.min(at, others - above)
  return anchors.slice(at - below, at + above + 1)
}

/** The quality options and the recommendation for one target. */
export function qualityChoice(
  evidence: QualityEvidence,
  targetTenths: number,
): QualityChoice {
  const anchors = anchorsFor(evidence, targetTenths)
  const recommended =
    RECOMMENDATION_ORDER.map((kind) => anchors.find((a) => a.kind === kind)).find(
      (anchor): anchor is QualityAnchor => anchor !== undefined,
    ) ?? anchors[0]
  if (recommended === undefined) {
    // Unreachable: a step above clears the floor of every target up to 4.9.
    throw new RangeError(`No planned quality clears the floor of ${targetTenths}`)
  }
  return {
    anchors,
    recommended,
    options: optionsAround(anchors, recommended),
    minimumTenths: minimumQualityTenths(targetTenths),
  }
}
