// The way to the Portal goal results page (`/goals/portal-results`; copy deck
// P-15, R-3, R-4): "All monthly results", at the goal page's foot and the
// Portal goals section's on the Goals page, once a month of a Portal goal has
// closed, and the way to the ended Portal goals on that page, once one has
// ended. Apart from the results page's own words (`portal-goal-results-view.ts`),
// so neither page loads any of that page; the anchor and the title R-4 names
// are held to that page's by its test.
//
// Pure.
import type { buildGoalResultsMatrix } from '#/contexts/reporting/application/public-api'

/** A Portal goal as the Goals list reads it, ended ones included, with its months. */
type PortalGoal = Parameters<typeof buildGoalResultsMatrix>[0]['programs'][number]

/** Where R-4 lands: the results page's ended Portal goals. */
export const ENDED_PORTAL_GOALS_HASH = 'ended'

/**
 * P-15 and R-3: the way to every month's result, at the goal page's foot and
 * the Portal goals section's, once a month has closed; none before.
 */
export const allResultsLink = (anyMonthClosed: boolean): string | null =>
  anyMonthClosed ? 'All monthly results' : null

/** R-3's condition: a month of a Portal goal has closed. */
export const anyPortalGoalMonthClosed = (programs: readonly PortalGoal[]): boolean =>
  programs.some(({ results }) => results.some(({ status }) => status === 'closed'))

/** R-4: "Ended portal goals (2)", once a Portal goal has ended; null before. */
export function endedPortalGoalsLink(programs: readonly PortalGoal[]): string | null {
  const count = programs.filter(({ program }) => program.status === 'ended').length
  return count === 0 ? null : `Ended portal goals (${count})`
}
