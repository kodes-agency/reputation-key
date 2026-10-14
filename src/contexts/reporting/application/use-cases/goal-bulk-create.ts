// Goal Program use cases — setting goals for several subjects in one save.
//
// One goal per row. Each row names a Portal or a Portal Group and its target,
// and becomes its own Program through `createGoalCore`, in its own
// transaction. The save is authorised once and its start month is resolved
// once, so every goal of one save starts in the same month and was set at the
// same instant. A row that cannot be saved is reported and never holds back
// the others; saving again is safe, because a subject that got its goal the
// first time reads `subject_has_goal` the second.
//
// A sibling of goal-program-create.ts: it imports the core from there and is
// composed beside the service (build.ts), not through goal-programs.ts.
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  isGoalBulkSubject,
  MAX_GOAL_BULK_ITEMS,
  type GoalBulkSubject,
} from '../../domain/goal-bulk-create'
import {
  goalSubjectIdentity,
  type GoalMetric,
  type GoalSubject,
} from '../../domain/goal-program'
import { resolveGoalStart, type GoalMonthlyPeriod } from '../../domain/goal-start'
import { goalMetricLabel } from '../goal-metric-label'
import { createGoalCore } from './goal-program-create'
import {
  assertOrganizationFreeToStartGoals,
  GoalProgramError,
  type GoalActor,
  type GoalExecutionPolicy,
  type GoalProgramDependencies,
} from './goal-program-shared'

/** A goal's name fits its column. */
const MAX_GOAL_NAME_LENGTH = 200

export type GoalBulkCreateInput = Readonly<{
  propertyId: string
  metric: GoalMetric
  /**
   * `YYYY-MM` on the Property's calendar: the current local month or the next
   * one. Every goal of the save starts in it.
   */
  startMonth: string
  items: readonly Readonly<{ subject: GoalSubject; targetValue: number }>[]
}>

/** Why a row got no goal. `failed` is a fault, not a refusal: saving again may work. */
type GoalBulkCreateRefusal =
  | 'subject_has_goal'
  | 'invalid_target'
  | 'invalid_subject'
  | 'metric_unavailable'
  | 'start_month_changed'
  | 'failed'

export type GoalBulkCreateOutcome =
  | Readonly<{ subject: GoalBulkSubject; code: 'created'; programId: string }>
  | Readonly<{ subject: GoalBulkSubject; code: GoalBulkCreateRefusal }>

/** One outcome per row, in the order the rows were sent. */
export type GoalBulkCreateResult = Readonly<{
  outcomes: readonly GoalBulkCreateOutcome[]
}>

export type GoalSubjectNameReader = Readonly<{
  /**
   * The name of a Portal or a Portal Group as its Property shows it. Null when
   * it is not a current Portal or group of that Property: unknown, archived, or
   * another Property's.
   */
  getSubjectName(
    organizationId: string,
    propertyId: string,
    subject: GoalBulkSubject,
  ): Promise<string | null>
}>

export type GoalBulkCreateDependencies = GoalProgramDependencies &
  Readonly<{
    subjectNames: GoalSubjectNameReader
    logger: LoggerPort
  }>

type GoalBulkRow = Readonly<{ subject: GoalBulkSubject; targetValue: number }>

/**
 * The refusals of `createGoalCore` that are about the row itself. Any other
 * refusal says nothing a row can act on and is a failed row.
 */
const ROW_REFUSALS: Readonly<
  Partial<Record<GoalProgramError['code'], GoalBulkCreateRefusal>>
> = {
  subject_has_goal: 'subject_has_goal',
  invalid_target: 'invalid_target',
  invalid_subject: 'invalid_subject',
  metric_unavailable: 'metric_unavailable',
  start_month_changed: 'start_month_changed',
}

/**
 * The rows of a save, or the refusal of the whole save: it has between one and
 * fifty rows, each for a Portal or a Portal Group, and no subject twice.
 */
function bulkRows(items: GoalBulkCreateInput['items']): readonly GoalBulkRow[] {
  if (items.length === 0) throw new GoalProgramError('invalid_subject')
  if (items.length > MAX_GOAL_BULK_ITEMS) {
    throw new GoalProgramError('assignment_limit_exceeded')
  }
  const rows = items.map(({ subject, targetValue }): GoalBulkRow => {
    if (!isGoalBulkSubject(subject)) throw new GoalProgramError('invalid_subject')
    return { subject, targetValue }
  })
  const identities = new Set(rows.map((row) => goalSubjectIdentity(row.subject)))
  if (identities.size !== rows.length) throw new GoalProgramError('duplicate_subject')
  return rows
}

/**
 * `{subject name} · {measure}`. A name too long for a goal loses the end of the
 * subject's name, never the measure: two goals of one subject differ by it.
 */
function bulkGoalName(subjectName: string, metric: GoalMetric): string {
  const suffix = ` · ${goalMetricLabel(metric)}`
  const kept = [...subjectName.trim()].slice(0, MAX_GOAL_NAME_LENGTH - suffix.length)
  return `${kept.join('').trimEnd()}${suffix}`
}

async function createGoalForRow(
  deps: GoalBulkCreateDependencies,
  input: GoalBulkCreateInput,
  actor: GoalActor,
  start: Readonly<{ now: Date; period: GoalMonthlyPeriod }>,
  row: GoalBulkRow,
): Promise<GoalBulkCreateOutcome> {
  const { subject, targetValue } = row
  try {
    const subjectName = await deps.subjectNames.getSubjectName(
      actor.organizationId,
      input.propertyId,
      subject,
    )
    if (subjectName === null) return { subject, code: 'invalid_subject' }
    const bundle = await createGoalCore(
      deps,
      {
        propertyId: input.propertyId,
        name: bulkGoalName(subjectName, input.metric),
        metric: input.metric,
        targetValue,
        subjects: [subject],
      },
      actor,
      start,
    )
    return { subject, code: 'created', programId: bundle.program.id }
  } catch (error) {
    const refusal =
      error instanceof GoalProgramError ? ROW_REFUSALS[error.code] : undefined
    if (refusal) return { subject, code: refusal }
    // Identifiers stay out of the log: the request's own trace names the save,
    // and the answer names the row.
    deps.logger.error(
      { error, metric: input.metric, subjectKind: subject.kind },
      'A goal of a save for several subjects was not created',
    )
    return { subject, code: 'failed' }
  }
}

/**
 * Create one goal per row. Refuses the whole save when its rows are not a
 * valid set (`invalid_subject`, `assignment_limit_exceeded`,
 * `duplicate_subject`), its month is no longer the current or the next one
 * on the Property's calendar (`start_month_changed`), or the Organization's
 * lifecycle holds it (`organization_closing`). After that every row has an
 * outcome.
 *
 * The rows are written one after another, so a save for this month can still
 * be running when the month ends. A goal written then would open a month that
 * is over: that row and every row after it read `start_month_changed`.
 */
export async function createGoalsForSubjects(
  deps: GoalBulkCreateDependencies,
  input: GoalBulkCreateInput,
  actor: GoalActor,
): Promise<GoalBulkCreateResult> {
  await deps.policy.authorize({
    actor,
    organizationId: actor.organizationId,
    propertyId: input.propertyId,
    action: 'goal.create',
  })
  await assertOrganizationFreeToStartGoals(deps, actor.organizationId)
  const rows = bulkRows(input.items)
  const timezone = await deps.subjects.getTimezone(actor.organizationId, input.propertyId)
  if (!timezone) throw new GoalProgramError('not_found')
  const now = deps.now()
  const resolved = resolveGoalStart(now, timezone, input.startMonth)
  if (!resolved.ok) throw new GoalProgramError('start_month_changed')
  const start = { now, period: resolved.period }

  const outcomes: GoalBulkCreateOutcome[] = []
  let monthEnded = false
  for (const row of rows) {
    monthEnded ||= deps.now() >= start.period.end
    outcomes.push(
      monthEnded
        ? { subject: row.subject, code: 'start_month_changed' }
        : await createGoalForRow(deps, input, actor, start, row),
    )
  }
  return { outcomes }
}

/** Request-facing: each invocation receives its scoped policy, like the Program commands. */
export type GoalBulkCreateRequestApi = Readonly<{
  createForSubjects: (
    policy: GoalExecutionPolicy,
    input: GoalBulkCreateInput,
    actor: GoalActor,
  ) => Promise<GoalBulkCreateResult>
}>
