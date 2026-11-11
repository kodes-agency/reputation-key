// Stale goal or month refusals refresh the read. Change sheets reopen on the latest
// state; already-set or stopped goals leave nothing to submit. Other refusals keep the
// shared goal wording.

import type { GoalRefusalSentences } from '../../../../components/goals/goal-refusal'
import { monthName } from './portal-goal-words'

export const PORTAL_SHEET_REFUSALS: GoalRefusalSentences = {
  revision_conflict: 'Someone changed this goal a moment ago. Here is the latest.',
  subject_has_goal: 'A monthly portal goal was set a moment ago. Here is the latest.',
}

/** The goal was stopped a moment ago, from a change or a second Stop. */
export const PORTAL_GOAL_ALREADY_STOPPED =
  'This goal was already stopped. Here is the latest.'

/** The refusals that mean the card is behind the server: it is read again. */
export const PORTAL_GOAL_BEHIND: ReadonlySet<string> = new Set([
  'revision_conflict',
  'subject_has_goal',
  'private_ratings_skipped',
  'start_month_changed',
  'month_locked',
])

/**
 * The refusals for a change of the goal, naming the month that ended and the
 * one it goes to.
 */
export function changeRefusals(month: string, next: string): GoalRefusalSentences {
  return {
    revision_conflict: PORTAL_SHEET_REFUSALS.revision_conflict,
    month_locked: `${monthName(month)} has ended. Set the number for ${monthName(next)} instead.`,
    invalid_transition: PORTAL_GOAL_ALREADY_STOPPED,
  }
}

/** The refusals that leave a change sheet behind the goal: it opens afresh on the latest. */
export const PORTAL_CHANGE_REOPENS: ReadonlySet<string> = new Set([
  'revision_conflict',
  'month_locked',
  'start_month_changed',
])
