// What the Property Overview says about the Monthly portal goal, worked out once
// (pure; PLAN PG-16, copy deck O-1…O-6). Its own slot, after "How you are
// doing" and above "Guest voice", never beside the Google rating goal's. It
// says at most one thing, from the card's own read: the number ready to use, in
// one line, until a manager chooses "Not now" for its month (O-1); the running
// month with each Portal's count (O-2); on the month's first seven days, for
// someone who may change the goal, the month-start check-in (O-3…O-6, the
// card's K-1…K-5). Nothing in the first weeks and at the gates, after "Not
// now", for a goal that has not started, once a goal was stopped, and while the
// read is on its way or failed: the goal never holds the Overview back. The
// read decides every state and number (PLAN E12); this only says them.
import type { PortalGoalMeasure } from '#/contexts/reporting/application/dto/goal-recommendation.types'
import type {
  PortalGoalCardView,
  PortalGoalCheckIn,
  PortalGoalOfCard,
  PortalGoalPrompt,
  PortalGoalRows,
  PortalGoalRunningMonth,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { PORTAL_GOAL_NAME } from './portal-goal-copy'
import { portalCountsWords } from './portal-goal-running-view'
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
  | Readonly<{ kind: 'card'; goal: PortalGoalOfCard; month: PortalGoalRunningMonth }>
  | Readonly<{
      kind: 'check_in'
      goal: PortalGoalOfCard
      checkIn: Extract<PortalGoalCheckIn, { kind: 'offer' | 'nothing' }>
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
      if (canChange && checkIn !== null && checkIn.kind !== 'same') {
        return { kind: 'check_in', goal, checkIn }
      }
      return { kind: 'card', goal, month: goal.month }
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

/** O-2: "Monthly portal goal · November". */
export const overviewTitle = (month: string): string =>
  `${PORTAL_GOAL_NAME} · ${monthName(month)}`

/**
 * O-2: each Portal's count in one line, in the read's name order, with "Other
 * portals" when something came from them. One Portal that brought in all of
 * it, or from 5 Portals how many, is the card's own sentence (G-27): null here.
 */
export function overviewCountsLine(rows: PortalGoalRows): string | null {
  const words = portalCountsWords(rows)
  if (words.kind === 'sentence') return null
  return words.rows.map(({ name, count }) => `${name} ${count}`).join(' · ')
}
