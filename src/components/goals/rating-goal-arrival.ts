// Open on arrival only where the page would offer setup: no active goal, an eligible
// Property and a viewer allowed to set it.

import type {
  RatingGoalCardView,
  RatingGoalSetupView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { ratingGoalStartIntent } from './rating-goal-overview-view'
import type { RatingGoalWizardIntent } from './rating-goal-wizard-view'

export type WizardOnArrival =
  /** The card or the setup is still on its way. */
  | Readonly<{ kind: 'wait' }>
  | Readonly<{ kind: 'open'; intent: RatingGoalWizardIntent }>
  /** Nothing to open: the page says what there is. */
  | Readonly<{ kind: 'skip' }>

export type ArrivalReads = Readonly<{
  /** Undefined while the card is read. */
  card: RatingGoalCardView | null | undefined
  cardFailed: boolean
  setup: RatingGoalSetupView | undefined
  setupFailed: boolean
  /** The viewer holds `goal.create`. */
  canCreate: boolean
}>

const WAIT: WizardOnArrival = { kind: 'wait' }
const SKIP: WizardOnArrival = { kind: 'skip' }

export function wizardOnArrival(reads: ArrivalReads): WizardOnArrival {
  if (!reads.canCreate || reads.cardFailed) return SKIP
  if (reads.card === undefined) return WAIT
  if (reads.card !== null && reads.card.state === 'active') return SKIP
  if (reads.setupFailed) return SKIP
  if (reads.setup === undefined) return WAIT
  if (!reads.setup.eligibility.eligible || reads.setup.hasActiveGoal) return SKIP
  return { kind: 'open', intent: ratingGoalStartIntent(reads.setup) }
}
