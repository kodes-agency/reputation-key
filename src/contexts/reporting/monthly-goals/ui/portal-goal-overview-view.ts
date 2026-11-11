// The goal never blocks the Overview. Hide unreadable, pending and ineligible prompts,
// and honour Not now for the offered month.

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
      /** The line offering the number. */
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
      /** The check-in that asks, drawn as the strip above the card; null when none does. */
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

/** "Your monthly portal goal for November is ready: 40 private ratings." */
export const overviewPromptWords = (
  prompt: PortalGoalPrompt,
  measure: PortalGoalMeasure,
): string =>
  `Your monthly portal goal for ${monthName(prompt.month)} is ready: ${portalGoalCount(measure, prompt.number)}.`
