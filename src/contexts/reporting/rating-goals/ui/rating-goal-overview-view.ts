// The goal never blocks the Overview. Honour Not now and hide prompts while reads are
// pending or failed; setup still requires eligibility and create permission.

import type {
  RatingGoalCardView,
  RatingGoalHistoryEntry,
  RatingGoalSetupView,
} from '#/contexts/reporting/rating-goals/contracts'
import {
  ratingGoalOutcome,
  ratingGoalOutcomeShowsNow,
  type RatingGoalOutcomeView,
} from './rating-goal-view'
import { ratingGoalStartIntent } from './rating-goal-offers'
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

export function overviewGoalView(reads: OverviewGoalReads): OverviewGoalView {
  const { card, setup } = reads
  if (card === undefined) return NOTHING
  if (card !== null && card.state === 'active') return { kind: 'card', card }
  const outcome = ratingGoalOutcome(card, reads.cardReadAt, reads.history, reads.now)
  if (outcome !== null) {
    return {
      kind: 'outcome',
      outcome,
      googleShowsNow: ratingGoalOutcomeShowsNow(card, setup),
      canSetNext: setup?.eligibility.eligible !== false,
    }
  }
  if (setup === undefined || !reads.canCreate || reads.notNowChosen !== false) {
    return NOTHING
  }
  if (!setup.eligibility.eligible || setup.hasActiveGoal) return NOTHING
  return { kind: 'prompt', intent: ratingGoalStartIntent(setup) }
}
