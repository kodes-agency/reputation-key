// What a Monthly portal goal command's refusal says when the card or the set
// sheet sent it (copy deck F-1, F-3, F-4). Each means the screen is behind the
// server, so the goal is read again with it: someone changed the goal (F-1), a
// goal was set a moment ago (F-3: the sheet closes on the latest), or the month
// turned while the sheet was open (F-4: the goal commands' own sentence, and
// the sheet re-reads its months). Every other refusal keeps the goal commands'
// sentence (`goal-refusal.ts`).
import type { GoalRefusalSentences } from './goal-refusal'

export const PORTAL_SHEET_REFUSALS: GoalRefusalSentences = {
  revision_conflict: 'Someone changed this goal a moment ago. Here is the latest.',
  subject_has_goal: 'A monthly portal goal was set a moment ago. Here is the latest.',
}

/** The refusals that mean the card is behind the server: it is read again. */
export const PORTAL_GOAL_BEHIND: ReadonlySet<string> = new Set([
  'revision_conflict',
  'subject_has_goal',
  'start_month_changed',
])
