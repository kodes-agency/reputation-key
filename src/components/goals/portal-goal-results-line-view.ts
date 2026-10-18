// The Monthly portal goal's line at the top of a Portal's Results tab (PLAN
// PG-16; copy deck R-1, R-2), worded (pure). With a goal for this Portal alone,
// that goal's month so far against its number and what is left to go; else
// what the Portal brought in toward the Monthly portal goal this month. Each
// with "Open goal" to the goal it names. The read decides which goal counts,
// the month and the numbers (PLAN E12); none (a draft Portal, no goal
// counting this month, or nothing yet toward the monthly goal) is no line.
import type { PortalGoalLineView } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { formatNumber } from '#/lib/format'
import { monthName, portalGoalCount, portalGoalUnit } from './portal-goal-words'

type PortalGoalResultsLineWords = Readonly<{
  text: string
  /** The goal "Open goal" opens: the monthly goal's page, or the Portal's own goal. */
  goal: Readonly<{ kind: 'monthly' }> | Readonly<{ kind: 'own'; programId: string }>
  open: string
}>

const OPEN_GOAL = 'Open goal'

export function resultsLineWords(
  line: PortalGoalLineView | null,
  portalName: string,
): PortalGoalResultsLineWords | null {
  if (line === null) return null
  const month = monthName(line.month)
  const { ownGoal, monthlyGoal } = line
  if (ownGoal !== null) {
    const { value, target, measure } = ownGoal
    const left = value >= target ? 'Goal passed' : `${formatNumber(target - value)} to go`
    return {
      // R-2: the unit follows the month's number, as the card's figure does.
      text: `${month} goal: ${formatNumber(value)} of ${formatNumber(target)} ${portalGoalUnit(measure, target)} · ${left}`,
      goal: { kind: 'own', programId: ownGoal.programId },
      open: OPEN_GOAL,
    }
  }
  if (monthlyGoal === null) return null
  const { count, measure } = monthlyGoal
  return {
    // R-1
    text: `${month} · ${portalName}’s ${portalGoalCount(measure, count)} ${count === 1 ? 'counts' : 'count'} toward the monthly portal goal.`,
    goal: { kind: 'monthly' },
    open: OPEN_GOAL,
  }
}
