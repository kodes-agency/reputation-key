// The Goals page opened to set a Google rating goal (pure): the setup strip's
// "Set a Google rating goal" and the Properties list's "Set goal" link there
// with `?start=rating-goal` (`rating-goal-arrival-search.ts`), and the wizard
// opens on arrival, so either is one click into it, as the Overview's prompt
// is. It opens only where the Goals page's own door would: no active goal, a
// goal can be set, and the viewer may set it. Otherwise the page is the answer
// (the card, or why no goal can be set).
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
