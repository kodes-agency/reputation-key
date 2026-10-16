// "Pick a plan", the one step of the Google rating goal wizard (round 2, R2-6 to
// R2-9), worked out from the setup read (pure). Three complete plans share one
// planned quality: Cautious, Recommended (preselected) and Ambitious. A change
// adds the goal's own plan as a fourth, "Your plan", and opens on it. "Build your
// own" is the manual way: while it is open it is the plan being set, and it
// starts from the plan picked when it was first opened. Nothing here is a date:
// a forecast is a month range.
import type {
  RatingForecastView,
  RatingGoalPlanningView,
  RatingGoalSetupView,
  RatingPlanKey,
  RatingPlanView,
  RatingQualityAnchorKind,
  RatingStopLabel,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { ratingGoalQualityChoice } from '#/contexts/reporting/application/rating-goal-planning'
import { previewRatingGoalPlan } from '#/contexts/reporting/application/rating-goal-preview'
import { formatNumber } from '#/lib/format'
import { forecastSentence, ratingText, reviewsText, tenthsText } from './rating-goal-view'
import type { RatingGoalWizardIntent } from './rating-goal-wizard-view'

/** A plan card's key, "Your plan" for the goal being changed. */
export type PlanCardKey = RatingPlanKey | 'current'

/** What "Set goal" sets: a plan card, or the plan built by hand. */
export type PlanSelection = PlanCardKey | 'own'

/** One row of "Build your own": one of its options, or "Own" and its number. */
export type RowPick = Readonly<{ own: boolean; value: number }>

/**
 * "Build your own": the target in tenths, the average in stars as typed (4.5,
 * or 4.55 that is not a tenth) and the reviews a week.
 */
export type OwnPlan = Readonly<{ target: RowPick; quality: RowPick; pace: RowPick }>

/**
 * What the manager has picked, held above the frame so a phone turned to
 * landscape keeps it. `previous` is the card "Build your own" goes back to when
 * it is closed; `own` stays as it was left once it was first opened.
 */
export type PlanDraft = Readonly<{
  selection?: PlanSelection
  previous?: PlanCardKey
  own?: OwnPlan
}>

/** A plan as saving sends it. */
export type PlanValues = Readonly<{
  targetTenths: number
  qualityTenths: number
  pacePerWeek: number
}>

export type PlanCard = Readonly<{
  key: PlanCardKey
  name: string
  /** "4.0": the number Google is to show. */
  target: string
  /** "2 a week · new reviews 4.5★ · 19 reviews". */
  line: string
  /** "Around Dec 2026 – Jan 2027", or why no month can be given. */
  forecastText: string | null
  /**
   * "More than a year" on a plan out of reach at its own pace: the cards wear
   * no Realistic or Stretch label, but a headline plan years away says so.
   */
  caution: string | null
  values: PlanValues
  forecast: RatingForecastView | null
}>

const PLAN_NAMES: Readonly<Record<PlanCardKey, string>> = {
  current: 'Your plan',
  cautious: 'Cautious',
  recommended: 'Recommended',
  ambitious: 'Ambitious',
}

/** What a plan out of reach at its own pace says: it takes more than 52 weeks. */
const MORE_THAN_A_YEAR = 'More than a year'

/**
 * "More than a year" for a plan out of reach at its own pace, unless its
 * forecast already says "More than ten years away".
 */
export const planCaution = (
  reach: RatingStopLabel | null,
  forecast: RatingForecastView | null,
): string | null =>
  reach === 'out_of_reach' && forecast?.kind !== 'beyond_horizon'
    ? MORE_THAN_A_YEAR
    : null

/** "4.5★". */
export const starsText = (stars: number): string => `${ratingText(stars)}★`

/** Stars as typed into whole tenths; NaN when they are not a whole tenth. */
export function starsToTenths(stars: number): number {
  const tenths = stars * 10
  const whole = Math.round(tenths)
  return Math.abs(tenths - whole) < 1e-6 ? whole : Number.NaN
}

/** "2 a week · new reviews 4.5★ · 19 reviews". */
function planLine(values: PlanValues, reviewsNeeded: number | null): string {
  return [
    `${formatNumber(values.pacePerWeek)} a week`,
    `new reviews ${starsText(values.qualityTenths / 10)}`,
    reviewsNeeded === null ? null : reviewsText(reviewsNeeded),
  ]
    .filter((part) => part !== null)
    .join(' · ')
}

/** What a plan needs and when it is expected, as the engine worked it out. */
type PlanOutlook = Readonly<{
  reviewsNeeded: number | null
  forecast: RatingForecastView | null
  reach: RatingStopLabel | null
}>

const NO_OUTLOOK: PlanOutlook = { reviewsNeeded: null, forecast: null, reach: null }

function cardOf(key: PlanCardKey, values: PlanValues, outlook: PlanOutlook): PlanCard {
  const target = values.targetTenths / 10
  const { forecast } = outlook
  return {
    key,
    name: PLAN_NAMES[key],
    target: ratingText(target),
    line: planLine(values, outlook.reviewsNeeded),
    forecastText: forecast === null ? null : forecastSentence(forecast, target, 'Around'),
    caution: planCaution(outlook.reach, forecast),
    values,
    forecast,
  }
}

const planCard = (plan: RatingPlanView): PlanCard =>
  cardOf(
    plan.key,
    {
      targetTenths: plan.targetTenths,
      qualityTenths: plan.qualityTenths,
      pacePerWeek: plan.pace.perWeek,
    },
    plan,
  )

/**
 * The goal being changed as "Your plan", worked out on today's numbers. A goal
 * to keep has no plan, so none. A goal stored before round 2 with no planned
 * quality is shown at its target's recommended one.
 */
export function currentPlanCard(
  setup: RatingGoalSetupView,
  intent: RatingGoalWizardIntent,
): PlanCard | null {
  const inputs = setup.forecastInputs
  if (intent.kind !== 'change' || inputs === null) return null
  const { goal } = intent
  if (goal.mode !== 'climb' || goal.pacePerWeek === null) return null
  const values: PlanValues = {
    targetTenths: goal.targetTenths,
    qualityTenths:
      goal.qualityTenths ??
      ratingGoalQualityChoice(inputs, goal.targetTenths).recommended.qualityTenths,
    pacePerWeek: goal.pacePerWeek,
  }
  const preview = previewRatingGoalPlan(inputs, values)
  return cardOf('current', values, preview.valid ? preview : NO_OUTLOOK)
}

/** "Your plan" first when there is one, then Cautious, Recommended and Ambitious. */
export function planCards(
  planning: RatingGoalPlanningView,
  current: PlanCard | null,
): readonly PlanCard[] {
  const plans = planning.plans.map(planCard)
  return current === null ? plans : [current, ...plans]
}

/** "Plans assume new reviews average 4.5★, like your best year (2024)". */
export function qualityAssumption(planning: RatingGoalPlanningView): string {
  const { recommended, targetTenths } = planning.quality
  const why = anchorReason(recommended.kind, recommended.year, targetTenths)
  return `Plans assume new reviews average ${starsText(recommended.quality)}, ${why}`
}

function anchorReason(
  kind: RatingQualityAnchorKind,
  year: number | null,
  targetTenths: number,
): string {
  switch (kind) {
    case 'like_now':
      return 'like your recent reviews'
    case 'best_year':
      return year === null ? 'like your best year' : `like your best year (${year})`
    case 'step_above':
      return `a step above what ${tenthsText(targetTenths)} needs`
    case 'excellent':
      return 'which is excellent'
  }
}

/** The card "Pick a plan" opens on: "Your plan" for a change, else Recommended. */
const openingCard = (cards: readonly PlanCard[]): PlanCardKey =>
  cards.some((card) => card.key === 'current') ? 'current' : 'recommended'

/** "Build your own" as it first opens: the plan picked, each row on its value. */
export const ownFrom = (values: PlanValues): OwnPlan => ({
  target: { own: false, value: values.targetTenths },
  quality: { own: false, value: values.qualityTenths / 10 },
  pace: { own: false, value: values.pacePerWeek },
})

/** The plan "Build your own" sends: its stars as tenths. */
export const ownValues = (own: OwnPlan): PlanValues => ({
  targetTenths: own.target.value,
  qualityTenths: starsToTenths(own.quality.value),
  pacePerWeek: own.pace.value,
})

export type ResolvedPlan = Readonly<{
  cards: readonly PlanCard[]
  /** Which card is checked; null while "Build your own" is the plan. */
  checked: PlanCardKey | null
  /** "Build your own", as it stands. */
  own: OwnPlan
  ownOpen: boolean
}>

/**
 * The draft as the step draws it. A re-read can take away the card a draft
 * picked (a change's "Your plan" when Google has caught up with it): it falls
 * back to where the step opens. Null when there is no plan to draw.
 */
export function resolvePlanDraft(
  setup: RatingGoalSetupView,
  planning: RatingGoalPlanningView,
  intent: RatingGoalWizardIntent,
  draft: PlanDraft,
): ResolvedPlan | null {
  const cards = planCards(planning, currentPlanCard(setup, intent))
  const cardAt = (key: PlanCardKey | undefined) => cards.find((card) => card.key === key)
  const picked = draft.selection === 'own' ? draft.previous : draft.selection
  const card = cardAt(picked) ?? cardAt(openingCard(cards)) ?? cards[0]
  if (card === undefined) return null
  const ownOpen = draft.selection === 'own'
  return {
    cards,
    checked: ownOpen ? null : card.key,
    own: draft.own ?? ownFrom(card.values),
    ownOpen,
  }
}

/** Opens "Build your own" on what is picked now, or as it was left. */
export function openOwn(draft: PlanDraft, resolved: ResolvedPlan): PlanDraft {
  if (resolved.ownOpen || resolved.checked === null) return draft
  return { selection: 'own', previous: resolved.checked, own: resolved.own }
}

/** Closes "Build your own": the card it was opened from is the plan again. */
export const closeOwn = (draft: PlanDraft): PlanDraft => ({
  ...draft,
  selection: draft.previous,
})

/** Picks a card: "Build your own" closes, and keeps what it holds. */
export const pickCard = (draft: PlanDraft, key: PlanCardKey): PlanDraft => ({
  ...draft,
  selection: key,
  previous: key,
})
