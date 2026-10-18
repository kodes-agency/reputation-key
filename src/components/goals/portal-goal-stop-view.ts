// What the Monthly portal goal's Stop says (copy deck X-1…X-5, F-5; PLAN
// PG-14). Stop only, never Pause: a running goal keeps counting its month to
// the last day and keeps its result, and a new goal can be set from the month
// after; a goal that has not started has counted nothing, so its month is free
// at once. The verb is "Stop" on the menu item and on the button (X-5). The
// days are the read's months, printed as calendar days.
import type { PortalGoalOfCard } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import type { GoalRefusalSentences } from './goal-refusal'
import { PORTAL_SHEET_REFUSALS } from './portal-goal-sheet-refusals'
import { dayWords, monthName } from './portal-goal-words'

/** F-5 (and F-1): a Stop refused because the page is behind. */
export const PORTAL_STOP_REFUSALS: GoalRefusalSentences = {
  invalid_transition: 'This goal was already stopped. Here is the latest.',
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

/** X-1…X-4: the question, what happens, and the two buttons. */
export function stopWords(goal: PortalGoalOfCard): Readonly<{
  title: string
  description: string
  cancel: string
  confirm: string
}> {
  const buttons = {
    title: 'Stop the monthly portal goal?',
    cancel: 'Keep the goal',
    confirm: 'Stop the goal',
  }
  const counting = goal.month?.key ?? goal.countingMonth?.key
  const first = goal.startsOn?.slice(0, 7)
  if (goal.status === 'scheduled' || counting === undefined) {
    // A goal that has not started names its first month; none is always one.
    const before =
      first === undefined
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
