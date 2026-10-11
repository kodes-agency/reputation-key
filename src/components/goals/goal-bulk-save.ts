// Set goals for several portals — what a save sends and what it leaves.
//
// A save sends every open row that has a number, as one goal each. Nothing is
// sent while a number does not suit the measure. What comes back is one outcome
// per row; the table keeps it as that row's report (goal-bulk-view.ts draws
// it), says the whole result in a sentence and moves the focus to the first
// row that got no goal.
import type { GoalMetric } from '#/contexts/reporting/application/public-api'
import { MAX_GOAL_BULK_ITEMS } from '#/contexts/reporting/application/dto/goal-bulk-create.dto'
import { goalTargetFault } from '#/contexts/reporting/application/dto/goal-program.dto'
import { goalSubjectKey } from './goal-subject-picker'
import type {
  GoalBulkOutcome,
  GoalBulkReport,
  GoalBulkRow,
  GoalBulkRowReport,
  GoalBulkSubject,
} from './goal-bulk-view'

export type GoalBulkSubmission =
  | Readonly<{
      ok: true
      items: readonly Readonly<{ subject: GoalBulkSubject; targetValue: number }>[]
    }>
  | Readonly<{
      ok: false
      /** What is wrong with a row's number, as the report that row then shows. */
      report: GoalBulkReport
      /** What is wrong with the save as a whole. */
      message: string | null
    }>

/**
 * What a save sends: every open row that has a number. Nothing is sent while a
 * number does not suit the measure, so a wrong row is put right first. A row
 * left empty (`NaN`) is skipped, and so is a row whose subject has a goal.
 */
export function goalBulkSubmission(
  rows: readonly GoalBulkRow[],
  targets: Readonly<Record<string, number>>,
  metric: GoalMetric,
): GoalBulkSubmission {
  const filled = rows
    .filter((row) => row.goal === null)
    .map((row) => ({ row, targetValue: targets[row.key] ?? Number.NaN }))
    .filter(({ targetValue }) => !Number.isNaN(targetValue))
  const report: GoalBulkReport = Object.fromEntries(
    filled.flatMap(({ row, targetValue }) => {
      const fault = goalTargetFault(metric, targetValue)
      return fault === null ? [] : [[row.key, { code: 'invalid_target', fault }] as const]
    }),
  )
  if (Object.keys(report).length > 0) return { ok: false, report, message: null }
  if (filled.length === 0) {
    return { ok: false, report, message: 'Enter a target for at least one portal.' }
  }
  if (filled.length > MAX_GOAL_BULK_ITEMS) {
    return {
      ok: false,
      report,
      message: `Set goals for up to ${MAX_GOAL_BULK_ITEMS} portals at a time.`,
    }
  }
  return {
    ok: true,
    items: filled.map(({ row, targetValue }) => ({ subject: row.subject, targetValue })),
  }
}

/**
 * The reports once a row's number changes. A fault was about the number the
 * row had, so it leaves with that number; any other reason a row got no goal
 * stays until the next save says otherwise.
 */
export function goalBulkReportOnEdit(
  report: GoalBulkReport,
  key: string,
): GoalBulkReport {
  if (report[key]?.code !== 'invalid_target') return report
  return Object.fromEntries(Object.entries(report).filter(([other]) => other !== key))
}

/** The first row the last save left without a goal: where the focus goes. */
export function goalBulkFirstFailed(
  report: GoalBulkReport,
  rows: readonly Readonly<{ key: string }>[],
): string | null {
  const failed = rows.find(({ key }) => {
    const code = report[key]?.code
    return code !== undefined && code !== 'created'
  })
  return failed?.key ?? null
}

/**
 * What one save left on the rows it was sent: a saved row keeps its goal and
 * the number it was saved with, a refused one its reason. The table lays it
 * over what earlier saves of the same measure and month left.
 */
export function goalBulkReportOf(
  outcomes: readonly GoalBulkOutcome[],
  sent: Readonly<{ metric: GoalMetric; targets: Readonly<Record<string, number>> }>,
): GoalBulkReport {
  const reported = outcomes.map((outcome): [string, GoalBulkRowReport] => {
    const key = goalSubjectKey(outcome.subject)
    const targetValue = sent.targets[key] ?? Number.NaN
    if (outcome.code === 'created') {
      return [key, { code: 'created', programId: outcome.programId, targetValue }]
    }
    if (outcome.code !== 'invalid_target') return [key, { code: outcome.code }]
    const fault = goalTargetFault(sent.metric, targetValue)
    return [
      key,
      { code: 'invalid_target', fault: fault ?? 'Enter a valid monthly target' },
    ]
  })
  return Object.fromEntries(reported)
}

/** The result of a save in a sentence or two, for the live region. */
export function goalBulkSummary(outcomes: readonly GoalBulkOutcome[]): string {
  const saved = outcomes.filter((outcome) => outcome.code === 'created').length
  const refused = outcomes.length - saved
  const goals = saved === 1 ? '1 goal' : `${saved === 0 ? 'No' : saved} goals`
  return refused === 0 ? `${goals} saved.` : `${goals} saved. ${refused} not saved.`
}
