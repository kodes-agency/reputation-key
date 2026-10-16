// What the Google rating goal wizard opens for, sends and says when it is done
// (pure). A goal to climb is one screen, opened already answered (rounds 3 and
// 4, E2/E4: `rating-goal-setup-*`); a goal to keep is one step too, offered
// first from a shown 4.7 (X1), the only choice at 4.9 or 5.0. The done screen repeats the
// time the setup showed (X11): no date, no month name.
import type { RatingGoalCardView } from '#/contexts/reporting/application/dto/rating-goal.types'
import type { RatingFraction } from '#/contexts/reporting/application/dto/rating-goal-setup.types'
import type {
  ChangeRatingGoalSchemaInput,
  SetRatingGoalSchemaInput,
} from '#/contexts/reporting/application/dto/rating-goal.dto'
import { HIGHEST_TARGET_TENTHS } from '#/contexts/reporting/application/rating-goal-setup-plan'
import { paceSentence } from './rating-goal-pace-words'
import { likelyText, whenText } from './rating-goal-setup-time'
import { tenthsText } from './rating-goal-view'

/**
 * The goal a change starts from, as the card read it: the setup opens on its
 * plan, and a change is compared with its stored tenths.
 */
export type RatingGoalBeingChanged = Pick<
  RatingGoalCardView,
  'goalId' | 'version' | 'mode' | 'targetTenths' | 'qualityTenths' | 'paceTenthsPerWeek'
>

/** Why the wizard opened: a goal to climb, a goal to keep, or a change. */
export type RatingGoalWizardIntent =
  | Readonly<{ kind: 'climb' }>
  | Readonly<{ kind: 'keep'; targetTenths: number }>
  | Readonly<{ kind: 'change'; goal: RatingGoalBeingChanged }>

export type WizardSubmission =
  | Readonly<{ kind: 'set'; data: SetRatingGoalSchemaInput }>
  | Readonly<{ kind: 'change'; data: ChangeRatingGoalSchemaInput }>

/**
 * What saving sends. A new goal is set whole; a change names only what differs
 * from the goal it was opened on, with that goal's version, and is null when
 * nothing does. The pace is in tenths of a review a week.
 */
export function wizardSubmission(
  intent: RatingGoalWizardIntent,
  propertyId: string,
  targetTenths: number,
  paceTenthsPerWeek: number | null,
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
        paceTenthsPerWeek: mode === 'keep' ? null : paceTenthsPerWeek,
      },
    }
  }
  const { goal } = intent
  const changes = {
    ...(goal.mode === 'climb' ? {} : { mode: 'climb' as const }),
    ...(goal.targetTenths === targetTenths ? {} : { targetTenths }),
    ...(goal.qualityTenths === qualityTenths ? {} : { qualityTenths }),
    ...(goal.paceTenthsPerWeek === paceTenthsPerWeek ? {} : { paceTenthsPerWeek }),
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
  /** "4.1 on Google", or "Keeping 4.9 on Google". */
  headline: string
  /** "About 1 a day · about 7 a week"; none for a goal to keep. */
  pace: string | null
  /** "In about 3 months, likely 9 weeks to 4 months.", as the setup said it (X11). */
  forecast: string | null
}>

/** What a save set, with the time the setup showed for it. */
export type SavedGoal = Readonly<{
  mode: 'climb' | 'keep'
  targetTenths: number
  paceTenthsPerWeek: number | null
  days: RatingFraction | null
  likely: Readonly<{ fast: RatingFraction; slow: RatingFraction | null }> | null
}>

const sentence = (text: string): string =>
  `${text.charAt(0).toUpperCase()}${text.slice(1)}`

/** The done screen's two or three lines, from what was saved. */
export function wizardReceipt(saved: SavedGoal): RatingGoalReceipt {
  const target = tenthsText(saved.targetTenths)
  if (saved.mode === 'keep' || saved.paceTenthsPerWeek === null) {
    return { headline: `Keeping ${target} on Google`, pace: null, forecast: null }
  }
  return {
    headline: `${target} on Google`,
    pace: `About ${paceSentence(saved.paceTenthsPerWeek)}`,
    forecast:
      saved.days === null || saved.likely === null
        ? null
        : `${sentence(whenText(saved.days))}, likely ${likelyText(saved.likely)}.`,
  }
}

/**
 * Why Keep comes first at a shown 4.7 or 4.8 (X1, owner 2026-10-16): the next
 * tenth needs new reviews of nearly five stars. Null where there is no higher
 * number at all.
 */
export function keepFirstSentence(shownTenths: number): string | null {
  const next = shownTenths + 1
  if (next > HIGHEST_TARGET_TENTHS) return null
  const shown = tenthsText(shownTenths)
  return next + 1 >= 50
    ? `${tenthsText(next)} needs every new review to be 5★, so we suggest keeping ${shown}.`
    : `${tenthsText(next)} needs new reviews averaging ${tenthsText(next + 1)}★ or more, so we suggest keeping ${shown}.`
}
