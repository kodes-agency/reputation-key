// What the Property Overview says about the Monthly portal goal, worked out once
// (pure; PLAN PG-16, copy deck O-1…O-6). Its own slot, after "How you are
// doing" and above "Guest voice", never beside the Google rating goal's. It
// says at most one thing, from the card's own read: the number ready to use, in
// one line, until a manager chooses "Not now" for its month (O-1); the running
// month, as the Goals page's card draws it (O-2), with the month-start check-in
// as the strip above it on the month's first seven days, for someone who may
// change the goal (O-3…O-6, the card's K-1…K-5; ADR 0068 amended 2026-10-19).
// Nothing in the first weeks and at the gates, after "Not now", for a goal that
// has not started, once a goal was stopped, and while the read is on its way or
// failed: the goal never holds the Overview back. The read decides every state
// and number (PLAN E12); this only says them.
import type { PortalGoalMeasure } from '#/contexts/reporting/application/dto/goal-recommendation.types'
import type {
  PortalGoalCardView,
  PortalGoalCheckIn,
  PortalGoalOfCard,
  PortalGoalPrompt,
  PortalGoalRunningMonth,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { monthName, portalGoalCount } from './portal-goal-words'

export type OverviewPortalGoalView =
  | Readonly<{ kind: 'nothing' }>
  | Readonly<{
      kind: 'prompt'
      /** O-1 */
      text: string
      /** `YYYY-MM`: the month "Not now" is for. */
      month: string
    }>
  | Readonly<{
      kind: 'card'
      goal: PortalGoalOfCard
      month: PortalGoalRunningMonth
      /** The Property's local day today. */
      today: string
      /** O-3…O-6: the check-in that asks, drawn as the strip above the card; null when none does. */
      checkIn: Extract<PortalGoalCheckIn, { kind: 'offer' | 'nothing' }> | null
    }>

type OverviewPortalGoalReads = Readonly<{
  /** The card's read; undefined while it is read, or when it failed. */
  card: PortalGoalCardView | undefined
  /** The viewer holds `goal.create`: the read, the prompt and Not now are theirs. */
  canSet: boolean
  /** The viewer holds `goal.update`: the check-in's Use and Keep are theirs. */
  canChange: boolean
}>

const NOTHING: OverviewPortalGoalView = { kind: 'nothing' }

export function overviewPortalGoalView({
  card,
  canSet,
  canChange,
}: OverviewPortalGoalReads): OverviewPortalGoalView {
  if (card === undefined || !canSet) return NOTHING
  switch (card.state) {
    case 'ready':
    case 'scans_only':
      return card.prompt.deferred
        ? NOTHING
        : {
            kind: 'prompt',
            text: overviewPromptWords(card.prompt, card.offer.measure),
            month: card.prompt.month,
          }
    case 'goal': {
      const { goal } = card
      // Scheduled, stopped, or with no month to show: the Goals page says it.
      if (goal.status !== 'active' || goal.month === null) return NOTHING
      const { checkIn } = goal
      return {
        kind: 'card',
        goal,
        month: goal.month,
        today: card.today,
        checkIn:
          canChange && checkIn !== null && checkIn.kind !== 'same' ? checkIn : null,
      }
    }
    default:
      return NOTHING
  }
}

/** O-1: "Your monthly portal goal for November is ready: 40 private ratings." */
export const overviewPromptWords = (
  prompt: PortalGoalPrompt,
  measure: PortalGoalMeasure,
): string =>
  `Your monthly portal goal for ${monthName(prompt.month)} is ready: ${portalGoalCount(measure, prompt.number)}.`
