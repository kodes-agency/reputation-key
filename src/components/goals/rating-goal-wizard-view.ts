// What the Google rating goal wizard offers and says, worked out from the setup
// read (pure). Step 1 picks a target on a slider of tenths; step 2 a weekly pace:
// Steady, Faster (preselected) or Push, or a whole number typed in. A goal to
// keep has one step. Nothing here is a date: a forecast is a month range.
import type {
  RatingForecastView,
  RatingGoalCardView,
  RatingGoalSetupView,
  RatingPaceKey,
  RatingStopLabel,
  RatingStopView,
  RecentMixView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import type {
  ChangeRatingGoalSchemaInput,
  SetRatingGoalSchemaInput,
} from '#/contexts/reporting/application/dto/rating-goal.dto'
import type { StatusMap } from '#/components/ui/status-badge'
import { previewRatingGoalPace } from '#/contexts/reporting/application/rating-goal-preview'
import { formatNumber } from '#/lib/format'
import {
  forecastSentence,
  newReviewsAWeek,
  perMonthAndDay,
  ratingText,
  reviewsText,
  tenthsText,
} from './rating-goal-view'

/** The goal a change starts from, as the card read it. */
export type RatingGoalBeingChanged = Pick<
  RatingGoalCardView,
  'goalId' | 'version' | 'mode' | 'targetTenths' | 'pacePerWeek'
>

/** Why the wizard opened: a goal to climb, a goal to keep, or a change. */
export type RatingGoalWizardIntent =
  | Readonly<{ kind: 'climb'; preselectTenths?: number }>
  | Readonly<{ kind: 'keep'; targetTenths: number }>
  | Readonly<{ kind: 'change'; goal: RatingGoalBeingChanged }>

export type PaceChoice =
  | Readonly<{ kind: 'preset'; key: RatingPaceKey }>
  | Readonly<{ kind: 'custom'; perWeek: number }>

/** How a stop's label reads as a chip. */
export const STOP_LABEL: StatusMap<RatingStopLabel> = {
  realistic: { label: 'Realistic', tone: 'positive' },
  stretch: { label: 'Stretch', tone: 'neutral' },
  out_of_reach: { label: 'Out of reach', tone: 'warn' },
}

/** Why 5.0 is on the scale and cannot be picked. */
export const PERFECT_STOP_REASON = 'needs every review from now on to be 5★'

const PACE_NAMES: Readonly<Record<RatingPaceKey, string>> = {
  steady: 'Steady',
  faster: 'Faster',
  push: 'Push',
}
const PACE_KEYS: readonly RatingPaceKey[] = ['steady', 'faster', 'push']

/** A custom pace is a whole number of reviews a week in this range. */
const CUSTOM_PACE = { min: 1, max: 200 } as const

export const stopAt = (
  setup: RatingGoalSetupView,
  tenths: number | null,
): RatingStopView | null =>
  setup.stops.find((stop) => stop.targetTenths === tenths) ?? null

/**
 * Where the slider opens: the target a change starts from, or the stop asked for
 * ("Set your next goal"), when the setup offers it; otherwise the setup's own
 * preselection. Null when there is no stop to climb to.
 */
export function openingTarget(
  setup: RatingGoalSetupView,
  intent: RatingGoalWizardIntent,
): number | null {
  const [first] = setup.stops
  if (first === undefined) return null
  const wanted =
    intent.kind === 'change'
      ? intent.goal.targetTenths
      : intent.kind === 'climb'
        ? intent.preselectTenths
        : undefined
  if (stopAt(setup, wanted ?? null) !== null) return wanted ?? null
  return stopAt(setup, setup.preselectedTenths)?.targetTenths ?? first.targetTenths
}

/** "4.7★": the recent mix's average stars. */
const mixStars = (mix: RecentMixView): string =>
  `${formatNumber(mix.average, { maximumFractionDigits: 2 })}★`

const mixText = (mix: RecentMixView | null): string =>
  mix === null ? 'recent' : `recent ${mixStars(mix)}`

/** The step's one live line: the reviews a stop needs, or that the mix never gets there. */
export function targetLine(stop: RatingStopView, mix: RecentMixView | null): string {
  if (stop.reviewsNeeded === null) return `Not reachable at your ${mixText(mix)} mix`
  return `About ${formatNumber(stop.reviewsNeeded)} more ${stop.reviewsNeeded === 1 ? 'review' : 'reviews'}`
}

/** The slider's value in words: "4.4, realistic, about 93 more reviews". */
export function stopValueText(stop: RatingStopView, mix: RecentMixView | null): string {
  const line = targetLine(stop, mix)
  return `${ratingText(stop.target)}, ${STOP_LABEL[stop.label].label.toLowerCase()}, ${line.charAt(0).toLowerCase()}${line.slice(1)}`
}

/** The warning an out-of-reach stop wears; it can still be picked. */
export function outOfReachWarning(
  stop: RatingStopView,
  setup: RatingGoalSetupView,
): string | null {
  if (stop.label !== 'out_of_reach') return null
  const pick = 'You can still pick it.'
  if (stop.reviewsNeeded === null) {
    return `Out of reach: at your ${mixText(setup.recentMix)} mix no pace gets Google to show ${ratingText(stop.target)}. ${pick}`
  }
  const faster = setup.paces.faster.perWeek
  return `Out of reach: even at ${formatNumber(faster)} new ${faster === 1 ? 'review' : 'reviews'} a week this takes more than a year. ${pick}`
}

/** "How we work this out": three short sentences, and a fourth when the numbers are approximate. */
export function howWeWorkItOut(
  setup: RatingGoalSetupView,
  stop: RatingStopView,
): readonly string[] {
  const google = setup.google
  const mix = setup.recentMix
  const sentences = [
    google === null || google.shows === null
      ? 'We start from Google’s own rating and review count.'
      : `We start from Google’s own rating and review count: ${ratingText(google.shows)} from ${reviewsText(google.reviewCount)}.`,
    mix === null
      ? 'We expect new reviews to keep your recent star mix.'
      : mix.basis === 'last_90_days'
        ? `We expect new reviews to keep your last 90 days’ star mix, ${mixStars(mix)}.`
        : `We expect new reviews to keep the star mix of your ${formatNumber(mix.reviewCount)} most recent reviews, ${mixStars(mix)}.`,
    `Google shows ${ratingText(stop.target)} once the exact average reaches ${formatNumber(stop.target - 0.05, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
  ]
  return setup.exactAverageSource === 'google'
    ? [
        ...sentences,
        'RepKey doesn’t hold every review Google counts yet, so these numbers are approximate.',
      ]
    : sentences
}

/** "You get about 7 a week now." */
export function currentPaceLine(perWeek: number): string {
  if (perWeek < 0.5) return 'You get fewer than one a week now'
  return `You get about ${formatNumber(Math.round(perWeek))} a week now`
}

export type PaceCard = Readonly<{
  key: RatingPaceKey
  name: string
  perWeek: string
  perMonthAndDay: string
  forecast: string
}>

/** Steady, Faster and Push, each with its forecast for the chosen target. */
export function paceCards(
  setup: RatingGoalSetupView,
  stop: RatingStopView,
): readonly PaceCard[] {
  return PACE_KEYS.map((key) => ({
    key,
    name: PACE_NAMES[key],
    perWeek: `${formatNumber(setup.paces[key].perWeek)} a week`,
    perMonthAndDay: perMonthAndDay(setup.paces[key]),
    forecast: forecastSentence(stop.forecasts[key], stop.target, 'Around'),
  }))
}

/** The pace the wizard opens on: Faster, or the pace of the goal being changed. */
export function openingPace(
  setup: RatingGoalSetupView,
  intent: RatingGoalWizardIntent,
): PaceChoice {
  const current = intent.kind === 'change' ? intent.goal.pacePerWeek : null
  if (current === null) return { kind: 'preset', key: 'faster' }
  const preset = PACE_KEYS.find((key) => setup.paces[key].perWeek === current)
  return preset === undefined
    ? { kind: 'custom', perWeek: current }
    : { kind: 'preset', key: preset }
}

export const paceChoicePerWeek = (
  setup: RatingGoalSetupView,
  choice: PaceChoice,
): number => (choice.kind === 'preset' ? setup.paces[choice.key].perWeek : choice.perWeek)

/** What is wrong with a pace typed in; null when it is a whole number from 1 to 200. */
export function customPaceProblem(perWeek: number): string | null {
  return Number.isInteger(perWeek) &&
    perWeek >= CUSTOM_PACE.min &&
    perWeek <= CUSTOM_PACE.max
    ? null
    : `Enter a whole number from ${CUSTOM_PACE.min} to ${CUSTOM_PACE.max}.`
}

export type WizardSubmission =
  | Readonly<{ kind: 'set'; data: SetRatingGoalSchemaInput }>
  | Readonly<{ kind: 'change'; data: ChangeRatingGoalSchemaInput }>

/**
 * What saving sends. A new goal is set whole; a change names only what differs
 * from the goal it was opened on, with that goal's version, and is null when
 * nothing does.
 */
export function wizardSubmission(
  intent: RatingGoalWizardIntent,
  propertyId: string,
  targetTenths: number,
  pacePerWeek: number | null,
): WizardSubmission | null {
  if (intent.kind !== 'change') {
    const mode = intent.kind === 'keep' ? 'keep' : 'climb'
    return {
      kind: 'set',
      data: {
        propertyId,
        mode,
        targetTenths,
        pacePerWeek: mode === 'keep' ? null : pacePerWeek,
      },
    }
  }
  const { goal } = intent
  const changes = {
    ...(goal.mode === 'climb' ? {} : { mode: 'climb' as const }),
    ...(goal.targetTenths === targetTenths ? {} : { targetTenths }),
    ...(goal.pacePerWeek === pacePerWeek ? {} : { pacePerWeek }),
  }
  if (Object.keys(changes).length === 0) return null
  return {
    kind: 'change',
    data: {
      propertyId,
      goalId: goal.goalId,
      expectedVersion: goal.version,
      ...changes,
    },
  }
}

/** What the done screen says was set. */
export type RatingGoalReceipt = Readonly<{
  /** "4.4 on Google", or "Keeping 4.9 on Google". */
  headline: string
  /** "About 11 new reviews a week"; none for a goal to keep. */
  pace: string | null
  /** "Expected around Nov 2026 – Jan 2027", or why there is no month. */
  forecast: string | null
}>

/** What a save set, with the forecast the wizard showed for it. */
export type SavedGoal = Readonly<{
  mode: 'climb' | 'keep'
  targetTenths: number
  pacePerWeek: number | null
  forecast: RatingForecastView | null
}>

/** The done screen's two or three lines, from what was saved. */
export function wizardReceipt(saved: SavedGoal): RatingGoalReceipt {
  const target = tenthsText(saved.targetTenths)
  if (saved.mode === 'keep' || saved.pacePerWeek === null) {
    return { headline: `Keeping ${target} on Google`, pace: null, forecast: null }
  }
  return {
    headline: `${target} on Google`,
    pace: `About ${newReviewsAWeek(saved.pacePerWeek)}`,
    forecast:
      saved.forecast === null
        ? null
        : forecastSentence(saved.forecast, saved.targetTenths / 10),
  }
}

/** The forecast of a chosen pace for a target: a suggested one's, or one typed in. */
export function choiceForecast(
  setup: RatingGoalSetupView,
  stop: RatingStopView,
  choice: PaceChoice,
): RatingForecastView | null {
  if (choice.kind === 'preset') return stop.forecasts[choice.key]
  if (setup.forecastInputs === null || customPaceProblem(choice.perWeek) !== null) {
    return null
  }
  return previewRatingGoalPace(setup.forecastInputs, stop.targetTenths, choice.perWeek)
    .forecast
}
