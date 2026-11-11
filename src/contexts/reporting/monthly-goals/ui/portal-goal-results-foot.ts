// Keep navigation words separate from the results page so callers do not load that
// page's implementation. Tests hold its anchor and title to the destination.

import type { buildGoalResultsMatrix } from '#/contexts/reporting/application/public-api'

/** A Portal goal as the Goals list reads it, ended ones included, with its months. */
type PortalGoal = Parameters<typeof buildGoalResultsMatrix>[0]['programs'][number]

/** Where the results link lands: the results page's ended Portal goals. */
export const ENDED_PORTAL_GOALS_HASH = 'ended'

/**
 * The way to every month's result, at the goal page's foot and
 * the Portal goals section's, once a month has closed; none before.
 */
export const allResultsLink = (anyMonthClosed: boolean): string | null =>
  anyMonthClosed ? 'All monthly results' : null

/** The condition for the link: a month of a Portal goal has closed. */
export const anyPortalGoalMonthClosed = (programs: readonly PortalGoal[]): boolean =>
  programs.some(({ results }) => results.some(({ status }) => status === 'closed'))

/** "Ended portal goals (2)", once a Portal goal has ended; null before. */
export function endedPortalGoalsLink(programs: readonly PortalGoal[]): string | null {
  const count = programs.filter(({ program }) => program.status === 'ended').length
  return count === 0 ? null : `Ended portal goals (${count})`
}
