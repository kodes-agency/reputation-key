// What the Google rating goal wizard opens for, sends and says when it is done
// (pure). A goal to climb is one step, "Pick a plan" (round 2, R2-6:
// `rating-goal-plan-view.ts`); a goal to keep is one step too, offered only when
// Google shows 4.9 or 5.0 (R2-9). Nothing here is a date: a forecast is a month
// range.
import type {
  RatingForecastView,
  RatingGoalCardView,
  RatingStopLabel,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import type {
  ChangeRatingGoalSchemaInput,
  SetRatingGoalSchemaInput,
} from '#/contexts/reporting/application/dto/rating-goal.dto'
import type { StatusMap } from '#/components/ui/status-badge'
import { forecastSentence, newReviewsAWeek, tenthsText } from './rating-goal-view'

/** The goal a change starts from, as the card read it. */
export type RatingGoalBeingChanged = Pick<
  RatingGoalCardView,
  'goalId' | 'version' | 'mode' | 'targetTenths' | 'qualityTenths' | 'pacePerWeek'
>

/** Why the wizard opened: a goal to climb, a goal to keep, or a change. */
export type RatingGoalWizardIntent =
  | Readonly<{ kind: 'climb' }>
  | Readonly<{ kind: 'keep'; targetTenths: number }>
  | Readonly<{ kind: 'change'; goal: RatingGoalBeingChanged }>

/** How a target's label reads as a chip, on the target row of "Build your own". */
export const STOP_LABEL: StatusMap<RatingStopLabel> = {
  realistic: { label: 'Realistic', tone: 'positive' },
  stretch: { label: 'Stretch', tone: 'neutral' },
  out_of_reach: { label: 'Out of reach', tone: 'warn' },
}

/** Why 5.0 is on the scale and cannot be picked. */
export const PERFECT_STOP_REASON = 'needs every review from now on to be 5★'

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
  qualityTenths: number | null,
): WizardSubmission | null {
  if (intent.kind !== 'change') {
    const mode = intent.kind === 'keep' ? 'keep' : 'climb'
    return {
      kind: 'set',
      data: {
        propertyId,
        mode,
        targetTenths,
        qualityTenths: mode === 'keep' ? null : qualityTenths,
        pacePerWeek: mode === 'keep' ? null : pacePerWeek,
      },
    }
  }
  const { goal } = intent
  const changes = {
    ...(goal.mode === 'climb' ? {} : { mode: 'climb' as const }),
    ...(goal.targetTenths === targetTenths ? {} : { targetTenths }),
    ...(goal.qualityTenths === qualityTenths ? {} : { qualityTenths }),
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
