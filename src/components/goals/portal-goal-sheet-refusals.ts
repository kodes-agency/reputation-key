// What a Monthly portal goal command's refusal says when the card or the sheet
// sent it (copy deck F-1…F-4). Each means the screen is behind the server, so
// the goal is read again with it: someone changed the goal (F-1: a change
// sheet then opens again on the latest), a goal was set a moment ago (F-3: the
// sheet closes on the latest), the month turned while the sheet was open (F-4:
// the goal commands' own sentence, and the sheet re-reads its months), or the
// month a change was for has ended (F-2: the change goes to the next month).
// Every other refusal keeps the goal commands' sentence (`goal-refusal.ts`).
import type { GoalRefusalSentences } from './goal-refusal'
import { monthName } from './portal-goal-words'

export const PORTAL_SHEET_REFUSALS: GoalRefusalSentences = {
  revision_conflict: 'Someone changed this goal a moment ago. Here is the latest.',
  subject_has_goal: 'A monthly portal goal was set a moment ago. Here is the latest.',
}

/** The refusals that mean the card is behind the server: it is read again. */
export const PORTAL_GOAL_BEHIND: ReadonlySet<string> = new Set([
  'revision_conflict',
  'subject_has_goal',
  'start_month_changed',
  'month_locked',
])

/** F-1 and F-2 for a change of the goal: the month that ended, and the one it goes to. */
export function changeRefusals(month: string, next: string): GoalRefusalSentences {
  return {
    revision_conflict: PORTAL_SHEET_REFUSALS.revision_conflict,
    month_locked: `${monthName(month)} has ended. Set the number for ${monthName(next)} instead.`,
  }
}
