// What the Property Overview says about the Google rating goal, worked out once
// (pure). The Overview is a first-time surface too, so it says at most one
// thing: the simple card of the active goal; a goal reached, or ended by
// something other than a manager, while that is news (the Goals page's rule);
// or, with no goal, a one-line prompt into the wizard, only where a goal can be
// set, the viewer may set it and no manager chose "Not now" for it (the setup
// strip's choice: a reminder after "Not now" is a nag). Nothing otherwise, and
// nothing while a read is on its way or failed: the goal never holds the
// Overview back.
import type {
  RatingGoalCardView,
  RatingGoalHistoryEntry,
  RatingGoalSetupView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import {
  outcomeFromCard,
  recentOutcome,
  type RatingGoalOutcomeView,
} from './rating-goal-view'
import type { RatingGoalWizardIntent } from './rating-goal-wizard-view'

export type OverviewGoalView =
  | Readonly<{ kind: 'nothing' }>
  | Readonly<{ kind: 'card'; card: RatingGoalCardView }>
  | Readonly<{
      kind: 'outcome'
      outcome: RatingGoalOutcomeView
      googleShowsNow: number | null
      canSetNext: boolean
    }>
  | Readonly<{ kind: 'prompt'; intent: RatingGoalWizardIntent }>

export type OverviewGoalReads = Readonly<{
  /** Undefined while the card is read, or when its read failed. */
  card: RatingGoalCardView | null | undefined
  /** When the card was read: the day a goal it found reached was reached. */
  cardReadAt: Date
  setup: RatingGoalSetupView | undefined
  history: readonly RatingGoalHistoryEntry[] | undefined
  /** The viewer holds `goal.create`. */
  canCreate: boolean
  /**
   * A manager chose "Not now" for the goal (the setup checklist's rating goal
   * step); undefined until the checklist is read.
   */
  notNowChosen: boolean | undefined
  now: Date
}>

const NOTHING: OverviewGoalView = { kind: 'nothing' }

/**
 * A door into the wizard opens it on what the setup offers first: "Pick a
 * plan", or keeping the number when Google shows 4.9 or 5.0 and nothing is
 * higher (round 2, R2-9). A low rating is always offered plans.
 */
export function ratingGoalStartIntent(
  setup: RatingGoalSetupView,
): RatingGoalWizardIntent {
  const shows = setup.google?.shows ?? null
  return setup.offerKeepFirst && shows !== null
    ? { kind: 'keep', targetTenths: Math.round(shows * 10) }
    : { kind: 'climb' }
}

export function overviewGoalView(reads: OverviewGoalReads): OverviewGoalView {
  const { card, setup } = reads
  if (card === undefined) return NOTHING
  if (card !== null && card.state === 'active') return { kind: 'card', card }
  const outcome =
    card === null
      ? recentOutcome(reads.history, reads.now)
      : outcomeFromCard(card, reads.cardReadAt)
  if (outcome !== null) {
    return {
      kind: 'outcome',
      outcome,
      googleShowsNow: setup?.google?.shows ?? null,
      canSetNext: setup?.eligibility.eligible !== false,
    }
  }
  if (setup === undefined || !reads.canCreate || reads.notNowChosen !== false) {
    return NOTHING
  }
  if (!setup.eligibility.eligible || setup.hasActiveGoal) return NOTHING
  return { kind: 'prompt', intent: ratingGoalStartIntent(setup) }
}
