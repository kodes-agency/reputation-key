// My results' plain answers (pure): the check-in pattern's question, answer and
// evidence, in a receptionist's words. Nothing here compares a person with anyone.
import { formatMonthDay, formatNumber } from '#/lib/format'
import type { GoalColumn } from '#/components/goals/goal-columns-view'
import type { StaffGoal, StaffPeriod, StaffResults } from './types'

const WHEN: Readonly<Record<StaffPeriod, string>> = {
  today: 'today',
  week: 'this week',
  month: 'this month',
  last_month: 'last month',
}

const counted = (count: number, one: string, many: string) =>
  `${formatNumber(count)} ${count === 1 ? one : many}`

export const staffScansQuestion = (period: StaffPeriod) =>
  period === 'last_month'
    ? 'Did guests scan your code?'
    : 'Are guests scanning your code?'

export function staffScansAnswer(scans: number, period: StaffPeriod) {
  if (scans > 0) return `Yes, ${counted(scans, 'guest', 'guests')} ${WHEN[period]}`
  return period === 'last_month' ? 'None last month' : `Not yet ${WHEN[period]}`
}

export function staffRatingsAnswer(results: StaffResults, period: StaffPeriod) {
  const count = results.ratingCount ?? 0
  if (count === 0)
    return period === 'last_month' ? 'No ratings last month' : 'No ratings yet'
  if (results.averageRating === undefined)
    return `${counted(count, 'rating', 'ratings')} so far`
  const average = formatNumber(results.averageRating, { maximumFractionDigits: 1 })
  return `${average}★ from ${counted(count, 'rating', 'ratings')}`
}

export function staffRatingsHint(results: StaffResults, period: StaffPeriod) {
  const lines = [
    results.averageRating === undefined && (results.ratingCount ?? 0) > 0
      ? 'Average shows after 5 ratings'
      : null,
    period === 'last_month' ? null : 'Up to last night',
  ]
  return lines.filter(Boolean).join('. ') || undefined
}

const isOwnGoal = (goal: StaffGoal) => !goal.name || goal.name === 'Your goal'

export const staffGoalCaption = (goal: StaffGoal) =>
  isOwnGoal(goal) ? 'Your goal this month' : `${goal.name}, shared this month`

/** The person's own goal leads; a Group's says it is shared. */
export function staffGoalAnswer(goals: readonly StaffGoal[]) {
  const lead = goals.find(isOwnGoal) ?? goals[0]
  if (!lead) return ''
  const left = Math.max(0, lead.target - lead.scans)
  if (left === 0)
    return isOwnGoal(lead) ? 'Goal reached this month' : `${lead.name} reached its goal`
  const scans = counted(left, 'scan', 'scans')
  return isOwnGoal(lead)
    ? `${scans} to go this month`
    : `${scans} to go, shared with ${lead.name}`
}

/** The server's Property days, as the bars show them. */
export function staffColumns(
  series: NonNullable<StaffResults['series']>,
): readonly GoalColumn[] {
  return series.columns.map((column) => {
    const label = formatMonthDay(`${column.start}T12:00:00Z`, 'UTC') ?? column.start
    const scans = counted(column.scans, 'scan', 'scans')
    return {
      key: column.start,
      label,
      value: column.scans,
      figure: formatNumber(column.scans),
      tone: column.open ? 'open' : 'since',
      mark: null,
      met: false,
      line: series.unit === 'day' ? `${label}: ${scans}` : `Week of ${label}: ${scans}`,
    }
  })
}
