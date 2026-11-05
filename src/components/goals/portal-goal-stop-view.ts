// Stop preserves the running month and result; an unstarted goal frees its month
// immediately. Use the read's next available month, including the hour before a new
// month opens. Format those months as calendar days.

import type {
  PortalGoalLastMonth,
  PortalGoalOfCard,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import type { GoalRefusalSentences } from './goal-refusal'
import {
  PORTAL_GOAL_ALREADY_STOPPED,
  PORTAL_SHEET_REFUSALS,
} from './portal-goal-sheet-refusals'
import { SINGLE_GOAL_WORDS } from './portal-goal-single-page-view'
import { dayWords, monthName } from './portal-goal-words'

/**
 * What a Stop is worded from: the Monthly portal goal on its card, or another
 * portal goal on its page (the average names no month it still counts).
 */
export type PortalGoalStopFacts = Pick<
  PortalGoalOfCard,
  'programId' | 'status' | 'startsOn' | 'change'
> &
  Readonly<{
    countingMonth?: Readonly<{ key: string }> | null
    lastMonth?: Pick<PortalGoalLastMonth, 'key' | 'outcome'> | null
  }>

/** Which goal a Stop is for: the Monthly portal goal, or one with a page of its own. */
export type PortalGoalStopKind = 'monthly' | 'single'

/** F-5 (and F-1): a Stop refused because the page is behind. */
export const PORTAL_STOP_REFUSALS: GoalRefusalSentences = {
  invalid_transition: PORTAL_GOAL_ALREADY_STOPPED,
  revision_conflict: PORTAL_SHEET_REFUSALS.revision_conflict,
}

/** `YYYY-MM-DD` of the last day of the month `YYYY-MM`, on the calendar. */
function lastDayOf(month: string): string {
  const year = Number(month.slice(0, 4))
  const number = Number(month.slice(5, 7))
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10)
}

/** The month after `YYYY-MM`, on the calendar. */
function monthAfter(month: string): string {
  const year = Number(month.slice(0, 4))
  const number = Number(month.slice(5, 7))
  return new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7)
}

/**
 * The month a Stop keeps, to its last day and with its result: the month open
 * now; a paused goal's last; or, in the hour before this month's is opened,
 * the month before, still being read (this one then never counts).
 */
function keptMonthOf(goal: PortalGoalStopFacts): string | undefined {
  if (goal.change?.now) return goal.change.now.monthKey
  if (goal.countingMonth) return goal.countingMonth.key
  return goal.lastMonth?.outcome === 'updating' ? goal.lastMonth.key : undefined
}

/** X-1…X-4: the question, what happens, and the two buttons. */
export function stopWords(
  goal: PortalGoalStopFacts,
  kind: PortalGoalStopKind = 'monthly',
): Readonly<{
  title: string
  description: string
  cancel: string
  confirm: string
}> {
  const buttons = {
    title:
      kind === 'single' ? SINGLE_GOAL_WORDS.stopTitle : 'Stop the monthly portal goal?',
    cancel: 'Keep the goal',
    confirm: 'Stop the goal',
  }
  const first = goal.startsOn?.slice(0, 7)
  const counting = keptMonthOf(goal)
  if (goal.status === 'scheduled' || counting === undefined) {
    // A goal that has not started names its first month; none is always one.
    const before =
      goal.status !== 'scheduled' || first === undefined
        ? ''
        : `${monthName(first)} has not started, so nothing has counted yet. `
    return { ...buttons, description: `${before}You can set a new goal straight away.` }
  }
  const next = goal.change?.nextMonthKey ?? monthAfter(counting)
  return {
    ...buttons,
    description: `${monthName(counting)} keeps counting to ${dayWords(lastDayOf(counting))} and keeps its result. You can set a new goal from ${monthName(next)}.`,
  }
}
