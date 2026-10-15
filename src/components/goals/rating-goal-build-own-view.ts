// "Build your own", worked out (pure): its three rows, Goal on Google, New
// reviews will average and New reviews a week, each with up to three options
// (one marked Recommended) and "Own", and the live total. Every number comes
// from the engine's own planning and preview on the setup read's exact inputs,
// so the page answers as the manager picks and agrees with what is saved
// (round 2, R2-6 to R2-9).
import type {
  RatingGoalForecastInputs,
  RatingGoalPlanningView,
  RatingGoalPlanPreview,
  RatingGoalSetupView,
  RatingPaceKey,
  RatingPlanProblem,
  RatingQualityAnchorKind,
  RatingQualityOptionView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { ratingGoalQualityChoice } from '#/contexts/reporting/application/rating-goal-planning'
import { previewRatingGoalPlan } from '#/contexts/reporting/application/rating-goal-preview'
import type { StatusPresentation } from '#/components/ui/status-badge'
import { formatNumber } from '#/lib/format'
import { forecastSentence, tenthsText } from './rating-goal-view'
import { ownValues, starsText, type OwnPlan, type RowPick } from './rating-goal-plan-view'
import { STOP_LABEL } from './rating-goal-wizard-view'

/** One option of a row: what it reads, its chip, and whether it is the recommendation. */
export type RowOption = Readonly<{
  /** The row's own unit: tenths of a target, stars of an average, reviews a week. */
  value: number
  title: string
  detail: string | null
  chip: StatusPresentation | null
  recommended: boolean
}>

/** The radio a row has checked: an option's value, or "own". */
export const OWN = 'own'

const PACE_KEYS: readonly RatingPaceKey[] = ['steady', 'faster', 'push']
const PACE_NAMES: Readonly<Record<RatingPaceKey, string>> = {
  steady: 'Steady',
  faster: 'Faster',
  push: 'Push',
}

/** "Goal on Google": the target row, each with its label. */
export const targetOptions = (planning: RatingGoalPlanningView): readonly RowOption[] =>
  planning.targets.map((option) => ({
    value: option.targetTenths,
    title: tenthsText(option.targetTenths),
    detail: null,
    chip: STOP_LABEL[option.label],
    recommended: option.recommended,
  }))

const ANCHOR_NAMES: Readonly<Record<RatingQualityAnchorKind, string>> = {
  like_now: 'Like now',
  best_year: 'Like your best year',
  step_above: 'A step above what',
  excellent: 'Excellent',
}

/** "Like now", "Like your best year (2024)", "A step above what 4.0 needs", "Excellent". */
function anchorName(option: RatingQualityOptionView, targetTenths: number): string {
  if (option.kind === 'step_above') {
    return `${ANCHOR_NAMES.step_above} ${tenthsText(targetTenths)} needs`
  }
  if (option.kind === 'best_year' && option.year !== null) {
    return `${ANCHOR_NAMES.best_year} (${option.year})`
  }
  return ANCHOR_NAMES[option.kind]
}

const aboutReviews = (count: number | null): string | null =>
  count === null
    ? null
    : `about ${formatNumber(count)} ${count === 1 ? 'review' : 'reviews'}`

/** "New reviews will average": the evidence anchors for a target, each with its cost. */
export function qualityOptions(
  inputs: RatingGoalForecastInputs,
  targetTenths: number,
): readonly RowOption[] {
  return ratingGoalQualityChoice(inputs, targetTenths).options.map((option) => ({
    value: option.quality,
    title: starsText(option.quality),
    detail: [anchorName(option, targetTenths), aboutReviews(option.reviewsNeeded)]
      .filter((part) => part !== null)
      .join(' · '),
    chip: null,
    recommended: option.recommended,
  }))
}

/** "New reviews a week": Steady, Faster (recommended) and Push. */
export const paceOptions = (
  setup: RatingGoalSetupView,
  planning: RatingGoalPlanningView,
): readonly RowOption[] =>
  PACE_KEYS.map((key) => ({
    value: setup.paces[key].perWeek,
    title: PACE_NAMES[key],
    detail: `${formatNumber(setup.paces[key].perWeek)} a week`,
    chip: null,
    recommended: key === planning.recommendedPaceKey,
  }))

/** Which radio a row has checked: "Own" when chosen, or when no option holds its value. */
export function rowChecked(pick: RowPick, options: readonly RowOption[]): string {
  if (pick.own) return OWN
  const option = options.find((each) => Math.abs(each.value - pick.value) < 1e-9)
  return option === undefined ? OWN : String(option.value)
}

/** The row's pick when one of its radios is checked. */
export function pickFromRadio(
  value: string,
  current: RowPick,
  options: readonly RowOption[],
): RowPick {
  const option = options.find((each) => String(each.value) === value)
  return option === undefined
    ? { own: true, value: current.value }
    : { own: false, value: option.value }
}

const twoDecimals = (value: number): string =>
  formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Under "New reviews will average": what the target needs, and what the recent
 * reviews averaged ("For 4.0 on Google, new reviews need to average above
 * 3.95★. Your last 25 averaged 3.92★.").
 */
export function qualityHint(setup: RatingGoalSetupView, targetTenths: number): string {
  const needs = `For ${tenthsText(targetTenths)} on Google, new reviews need to average above ${twoDecimals(targetTenths / 10 - 0.05)}★.`
  const mix = setup.recentMix
  if (mix === null) return needs
  const stars = `${formatNumber(mix.average, { maximumFractionDigits: 2 })}★`
  const recent =
    mix.basis === 'last_90_days'
      ? `Your last 90 days averaged ${stars}.`
      : `Your last ${formatNumber(mix.reviewCount)} averaged ${stars}.`
  return `${needs} ${recent}`
}

/** What a row says is wrong with its "Own" number, in plain words. */
export type RowProblems = Readonly<{
  target: string | null
  quality: string | null
  pace: string | null
}>

function problemText(problem: RatingPlanProblem, targetTenths: number): string {
  switch (problem.code) {
    case 'target_out_of_range':
      return `Pick a goal from ${tenthsText(problem.minimumTenths)} to ${tenthsText(problem.maximumTenths)}.`
    case 'quality_too_low':
      return `For ${tenthsText(targetTenths)}, pick ${starsText(problem.minimumTenths / 10)} or more: any nearer ${twoDecimals(targetTenths / 10 - 0.05)}★ and the reviews needed climb very fast.`
    case 'quality_out_of_range':
      return `Enter an average up to ${starsText(problem.maximumTenths / 10)}, in steps of 0.1.`
    case 'pace_out_of_range':
      return `Enter a whole number from ${problem.minimum} to ${problem.maximum}.`
  }
}

export function rowProblems(preview: RatingGoalPlanPreview, own: OwnPlan): RowProblems {
  const problems = preview.valid ? [] : preview.problems
  const text = (field: RatingPlanProblem['field']) => {
    const problem = problems.find((each) => each.field === field)
    return problem === undefined ? null : problemText(problem, own.target.value)
  }
  return { target: text('target'), quality: text('quality'), pace: text('pace') }
}

/** "Build your own" worked out: the engine's preview of what it holds. */
export const ownPreview = (
  inputs: RatingGoalForecastInputs,
  own: OwnPlan,
): RatingGoalPlanPreview => previewRatingGoalPlan(inputs, ownValues(own))

/** The live total: "19 more reviews · around Dec 2026 – Jan 2027". */
export function ownTotal(preview: RatingGoalPlanPreview, own: OwnPlan): string {
  if (!preview.valid) return 'Fix the number marked above to see what this plan takes.'
  const target = own.target.value / 10
  const when = forecastSentence(preview.forecast, target, 'around')
  if (preview.reviewsNeeded === null) return when
  const count = preview.reviewsNeeded
  return `${formatNumber(count)} more ${count === 1 ? 'review' : 'reviews'} · ${when.charAt(0).toLowerCase()}${when.slice(1)}`
}

/** The quality floor of a target, in stars: the lowest "Own" average it takes. */
export const qualityFloorStars = (
  inputs: RatingGoalForecastInputs,
  targetTenths: number,
): number => ratingGoalQualityChoice(inputs, targetTenths).minimumTenths / 10
