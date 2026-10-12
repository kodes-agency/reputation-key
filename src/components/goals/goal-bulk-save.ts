// Set goals for several portals — what a save sends and what it leaves.
//
// A save sends every open row that has a number, as one goal each. Nothing is
// sent while a number does not suit the measure. What comes back is one outcome
// per row; the table keeps it as that row's report (goal-bulk-view.ts draws
// it, goal-bulk-entries.ts keeps it), says the whole result in a sentence and
// moves the focus to the first row that got no goal. A save refused as a whole
// is one sentence above the button.
import type { GoalMetric } from '#/contexts/reporting/application/public-api'
import { MAX_GOAL_BULK_ITEMS } from '#/contexts/reporting/application/dto/goal-bulk-create.dto'
import { goalTargetFault } from '#/contexts/reporting/application/dto/goal-program.dto'
import { isServerFunctionError } from '#/shared/auth/server-function-error'
import { goalRefusal, goalRefusalCode } from './goal-refusal'
import { goalSubjectKey } from './goal-subject-picker'
import type {
  GoalBulkOutcome,
  GoalBulkReport,
  GoalBulkRow,
  GoalBulkRowReport,
  GoalBulkSubject,
} from './goal-bulk-view'

const TOO_MANY = `Set goals for up to ${MAX_GOAL_BULK_ITEMS} portals at a time.`

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
 * left empty (`NaN`) is skipped. `unreadable` names the rows whose field holds
 * text it cannot read as a number: the table sees those as empty too, and only
 * the field can tell, so they are a fault and not a row to skip in silence.
 */
export function goalBulkSubmission(
  rows: readonly GoalBulkRow[],
  targets: Readonly<Record<string, number>>,
  metric: GoalMetric,
  unreadable: readonly string[] = [],
): GoalBulkSubmission {
  const filled = rows
    .filter((row) => row.open)
    .flatMap((row) => {
      // `NaN` is no number for any measure, which is what the fault below says.
      if (unreadable.includes(row.key)) return [{ row, targetValue: Number.NaN }]
      const targetValue = targets[row.key] ?? Number.NaN
      return Number.isNaN(targetValue) ? [] : [{ row, targetValue }]
    })
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
  if (filled.length > MAX_GOAL_BULK_ITEMS) return { ok: false, report, message: TOO_MANY }
  return {
    ok: true,
    items: filled.map(({ row, targetValue }) => ({ subject: row.subject, targetValue })),
  }
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

/**
 * What the banner above the button says when the command refuses the whole
 * save. Each code has its sentence (goal-refusal.ts); two of them speak of one
 * goal there and are said here in the table's own words. A failure that is not
 * a refusal is handed on, and the banner applies its own rule to it.
 */
export function goalBulkRefusal(error: unknown): unknown {
  switch (goalRefusalCode(error)) {
    case 'not_found':
      return 'This property can’t be found.'
    case 'assignment_limit_exceeded':
      return TOO_MANY
    default:
      return goalRefusal(error)
  }
}

/**
 * Whether a save that threw may still have written goals. The command refuses
 * a whole save before it writes a row (a 4xx), but it writes each row on its
 * own, so a fault or a lost connection can come after some were saved. The
 * table then reads the goals again before the person saves a second time.
 */
export function goalBulkMayHaveSaved(error: unknown): boolean {
  return !isServerFunctionError(error) || error.status < 400 || error.status >= 500
}
