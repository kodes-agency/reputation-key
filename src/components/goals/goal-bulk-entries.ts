// Set goals for several portals — what has been typed and what the saves left,
// for every table the view has shown.
//
// The view is one table per measure and start month. A number belongs to its
// measure: 12 private ratings is not 12 scans and can never be a rating
// average, so another measure starts with empty rows, and the numbers of the
// first come back with it. The start month is not part of that: the same number
// means the same thing next month. What a save said about a row belongs to the
// measure and the month it was saved for.
import type { GoalMetric } from '#/contexts/reporting/application/public-api'
import type { GoalBulkReport, GoalBulkRowReport } from './goal-bulk-view'

/** One table of the view. */
export type GoalBulkScope = Readonly<{
  metric: GoalMetric
  /** `YYYY-MM` on the Property's calendar. */
  startMonth: string
}>

type ByMeasure<Value> = Readonly<Partial<Record<GoalMetric, Value>>>

export type GoalBulkEntries = Readonly<{
  /** The number on each open row, by measure, then subject key; none or `NaN` is empty. */
  targets: ByMeasure<Readonly<Record<string, number>>>
  /** What the saves left on the rows, by measure, then start month. */
  reports: ByMeasure<Readonly<Record<string, GoalBulkReport>>>
}>

export const GOAL_BULK_NO_ENTRIES: GoalBulkEntries = { targets: {}, reports: {} }

const NOTHING: Readonly<Record<string, never>> = {}

/** The numbers typed for a measure, by subject key. */
export const goalBulkTargetsOf = (
  entries: GoalBulkEntries,
  metric: GoalMetric,
): Readonly<Record<string, number>> => entries.targets[metric] ?? NOTHING

/** What the saves of one table left on its rows. */
export const goalBulkReportIn = (
  entries: GoalBulkEntries,
  scope: GoalBulkScope,
): GoalBulkReport => entries.reports[scope.metric]?.[scope.startMonth] ?? NOTHING

const keep = <Value>(
  record: Readonly<Record<string, Value>>,
  wanted: (value: Value, key: string) => boolean,
): Readonly<Record<string, Value>> =>
  Object.fromEntries(Object.entries(record).filter(([key, value]) => wanted(value, key)))

const withReport = (
  entries: GoalBulkEntries,
  scope: GoalBulkScope,
  report: GoalBulkReport,
): GoalBulkEntries => ({
  ...entries,
  reports: {
    ...entries.reports,
    [scope.metric]: { ...entries.reports[scope.metric], [scope.startMonth]: report },
  },
})

/**
 * A number typed on a row. A fault was about the number the row had, so it
 * leaves with that number, in every month of the measure: the number is the
 * same one there. Any other reason a row got no goal stays until a save
 * answers for it.
 */
export function goalBulkEdited(
  entries: GoalBulkEntries,
  metric: GoalMetric,
  key: string,
  value: number,
): GoalBulkEntries {
  const months = Object.entries(entries.reports[metric] ?? NOTHING).map(
    ([month, report]) =>
      [
        month,
        keep(report, (left, row) => row !== key || left.code !== 'invalid_target'),
      ] as const,
  )
  return {
    targets: {
      ...entries.targets,
      [metric]: { ...entries.targets[metric], [key]: value },
    },
    reports: { ...entries.reports, [metric]: Object.fromEntries(months) },
  }
}

/**
 * An attempt that was not sent, because a number does not suit the measure.
 * Its faults replace those of the attempt before; what the last save said
 * about the other rows still holds, since nothing was asked of them.
 */
export function goalBulkHeldBack(
  entries: GoalBulkEntries,
  scope: GoalBulkScope,
  faults: GoalBulkReport,
): GoalBulkEntries {
  const before = keep(
    goalBulkReportIn(entries, scope),
    (left) => left.code !== 'invalid_target',
  )
  return withReport(entries, scope, { ...before, ...faults })
}

/** What no later save changes: a goal that was created, a subject that is gone. */
const isSettled = (left: GoalBulkRowReport): boolean =>
  left.code === 'created' || left.code === 'invalid_subject'

/**
 * An attempt the command answered. `left` says what became of each row that
 * was sent. A row that was not sent this time (its number was cleared) has
 * nothing held against it any more, unless its fate is settled. A row that got
 * its goal gives up its number: the goal has it now, and a number left behind
 * would be sent again as soon as the row opened under another start month.
 */
export function goalBulkAnswered(
  entries: GoalBulkEntries,
  scope: GoalBulkScope,
  left: GoalBulkReport,
): GoalBulkEntries {
  const settled = keep(goalBulkReportIn(entries, scope), isSettled)
  const answered = withReport(entries, scope, { ...settled, ...left })
  return {
    ...answered,
    targets: {
      ...answered.targets,
      [scope.metric]: keep(
        goalBulkTargetsOf(answered, scope.metric),
        (_value, key) => left[key]?.code !== 'created',
      ),
    },
  }
}
