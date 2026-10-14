// Goal Program use cases — maintenance: activating scheduled Programs, opening
// the monthly results that have come due, and reconciling and closing them.
//
// These commands run from the hourly maintenance job and the correction
// consumer, not from a request. The service composes them (goal-programs.ts)
// and re-exports the maintenance error so its importers stay where they were.
// The one piece a request uses is `loadCaughtUpProgram`: the change commands
// open a Program's due months with it before they read its head.
import type { GovernedGoalMetricResult } from './query-goal-metric'
import {
  organizationId as toOrganizationId,
  propertyId as toPropertyId,
} from '#/shared/domain/ids'
import type {
  GoalMonthlyResult,
  GoalProgramBundle,
  GoalProgramVersion,
  GoalSubjectAssignment,
} from '../ports/goal-program.repository'
import {
  evaluateGoalMetric,
  isGoalResultReadyToClose,
  type GoalMetric,
  type GoalMetricEvaluation,
} from '../../domain/goal-program'
import { effectiveMonthTarget } from '../goal-effective-month-target'
import {
  dueMonthlyPeriods,
  GoalProgramError,
  loadChangeableProgram,
  metricSubject,
  openResultsForPeriods,
  type GoalActor,
  type GoalProgramDependencies,
} from './goal-program-shared'

export type GoalProgramMaintenanceStats = Readonly<{
  inspected: number
  activated: number
  scheduledResults: number
  reconciled: number
  closed: number
  denied: number
  unavailable: number
  /**
   * Due results whose month runs past their assignment or version window. The
   * database refuses every update to one, so retrying cannot help; they are
   * reported here instead of failing every run.
   */
  stranded: number
  /**
   * Due results another run settled first (already closed, or its
   * compare-and-set lost). The run that won did the work; nothing failed.
   */
  raced: number
  failed: number
  /**
   * What the failed operations died of, by content-free cause: a Goal error
   * code, `sqlstate_<code>` for a database refusal, else the error's class.
   * Never a message or an identifier (BQC-7.3).
   */
  failureCauses: Readonly<Record<string, number>>
}>

/**
 * Makes partial maintenance failures visible to BullMQ so its governed retry
 * and quarantine policy can act. The stats are identifier-free and safe to
 * report; individual tenant/program identifiers never cross this boundary.
 */
// Exported because it is thrown OUT of the module: the service re-exports it
// (goal-programs.ts), and the maintenance job discriminates it with
// `instanceof` so BullMQ's retry policy can act on it, rather than
// string-matching `error.name`.
export class GoalProgramMaintenanceError extends Error {
  constructor(readonly stats: GoalProgramMaintenanceStats) {
    super(
      `Goal Program maintenance had ${stats.failed} failed operation(s)${causesOf(stats.failureCauses)}`,
    )
    this.name = 'GoalProgramMaintenanceError'
  }
}

function causesOf(causes: Readonly<Record<string, number>>): string {
  const named = Object.entries(causes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([cause, count]) => `${cause} x${count}`)
  return named.length === 0 ? '' : `: ${named.join(', ')}`
}

const SQLSTATE = /^[0-9A-Z]{5}$/u

/** The SQLSTATE of a database refusal, through the query error that wraps it. */
function sqlStateOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const { code, cause } = error as { code?: unknown; cause?: unknown }
  if (typeof code === 'string' && SQLSTATE.test(code)) return code
  return sqlStateOf(cause)
}

/**
 * What an operation failed of, in words that name no tenant: the code of a Goal
 * error, the SQLSTATE of a database refusal, else the class of the error.
 */
function failureCauseOf(error: unknown): string {
  if (error instanceof GoalProgramError) return error.code
  const sqlState = sqlStateOf(error)
  if (sqlState !== null) return `sqlstate_${sqlState}`
  return error instanceof Error ? error.name : 'unknown'
}

function evaluationFromGovernedRead(
  metric: GoalMetric,
  target: number,
  reading: GovernedGoalMetricResult,
): GoalMetricEvaluation {
  if (reading.state === 'insufficient_data') {
    return {
      state: 'insufficient_data',
      value: null,
      sampleCount: reading.sampleCount,
      achieved: null,
      reason: reading.reason ?? 'minimum_sample_not_met',
    }
  }
  return evaluateGoalMetric({
    metric,
    target,
    reading: {
      dataQuality: reading.state,
      exactValue: reading.exactValue,
      sampleCount: reading.sampleCount,
    },
  })
}

function sameGoalEvaluation(
  left: GoalMetricEvaluation,
  right: GoalMetricEvaluation,
): boolean {
  return (
    left.state === right.state &&
    left.value === right.value &&
    left.sampleCount === right.sampleCount &&
    left.achieved === right.achieved &&
    left.reason === right.reason
  )
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime()
}

/**
 * Raised when a due result's month runs past its assignment or version window.
 * The database refuses every update to such a result, so maintenance counts it
 * rather than failing the whole run on it every hour.
 */
class GoalResultOutsideWindowError extends Error {
  constructor() {
    super('Goal monthly result falls outside its assignment or version window')
    this.name = 'GoalResultOutsideWindowError'
  }
}

/**
 * Raised when a due result's program, assignment or version row is missing.
 * Unlike a result another run settled first, nothing settled it: a row it
 * points to is gone, which the foreign keys make close to impossible. The run
 * fails and names this class as its cause, instead of counting a lost race.
 */
class GoalResultReferenceMissingError extends Error {
  constructor() {
    super(
      'Goal monthly result refers to a program, assignment or version that is missing',
    )
    this.name = 'GoalResultReferenceMissingError'
  }
}

/** Mirrors the monthly-result guard's window check in the database. */
function isOutsideItsWindow(
  result: GoalMonthlyResult,
  assignment: GoalSubjectAssignment,
  version: GoalProgramVersion,
): boolean {
  return [assignment, version].some(
    (window) =>
      result.periodStart < window.effectiveFrom ||
      (window.effectiveTo !== null && result.periodEnd > window.effectiveTo),
  )
}

/**
 * False when policy refuses this system maintenance pass for the bundle. Any
 * other authorization failure is not a per-program outcome and propagates.
 */
async function maintenanceAuthorized(
  deps: GoalProgramDependencies,
  bundle: GoalProgramBundle,
): Promise<boolean> {
  try {
    await deps.policy.authorize({
      actor: 'system',
      organizationId: bundle.program.organizationId,
      propertyId: bundle.program.propertyId,
      action: 'goal.update',
    })
    return true
  } catch (error) {
    if (error instanceof GoalProgramError && error.code === 'forbidden') return false
    throw error
  }
}

/**
 * `not_due` leaves the bundle untouched for the append pass; `unavailable` and
 * `skipped` end the program's turn, the former counting against readiness.
 */
type ScheduledActivation =
  | Readonly<{ kind: 'not_due' }>
  | Readonly<{ kind: 'unavailable' }>
  | Readonly<{ kind: 'skipped' }>
  | Readonly<{
      kind: 'activated'
      bundle: GoalProgramBundle
      scheduledResults: number
    }>

async function activateScheduledProgram(
  deps: GoalProgramDependencies,
  bundle: GoalProgramBundle,
  now: Date,
): Promise<ScheduledActivation> {
  if (!(bundle.program.status === 'scheduled' && bundle.version.effectiveFrom <= now)) {
    return { kind: 'not_due' }
  }
  const assignment = bundle.assignments.find(
    (candidate) => candidate.programVersionId === bundle.version.id,
  )
  if (!assignment) return { kind: 'unavailable' }
  const periods = dueMonthlyPeriods(bundle.version, null, now)
  const period = periods[0]
  if (!period) return { kind: 'skipped' }
  const readiness = await deps.metrics.queryGoalMetric({
    organizationId: toOrganizationId(bundle.program.organizationId),
    propertyId: toPropertyId(bundle.program.propertyId),
    definitionVersionId: bundle.version.metricDefinitionVersionId,
    subject: metricSubject(assignment.subject),
    periodStart: period.start,
    periodEnd: period.end,
  })
  if (
    readiness.reason === 'metric_source_not_active' ||
    readiness.state === 'unavailable' ||
    readiness.state === 'quarantined'
  ) {
    return { kind: 'unavailable' }
  }
  const newResults = openResultsForPeriods(bundle, periods, deps.id, now)
  const active = await deps.repository.activate({
    bundle,
    results: newResults,
    at: now,
  })
  if (!active) return { kind: 'skipped' }
  return {
    kind: 'activated',
    bundle: {
      ...bundle,
      program: active,
      results: [...bundle.results, ...newResults],
    },
    scheduledResults: newResults.length,
  }
}

type DueResultsOutcome = Readonly<{
  /** Monthly results that had come due and were missing from the bundle. */
  due: number
  /** How many of them this call wrote; fewer when another writer got there first. */
  opened: number
}>

/** Opens the monthly results that have come due since the latest one, if any. */
async function appendDueResults(
  deps: GoalProgramDependencies,
  bundle: GoalProgramBundle,
  now: Date,
): Promise<DueResultsOutcome> {
  if (bundle.program.status !== 'active') return { due: 0, opened: 0 }
  const currentResults = bundle.results.filter(
    (result) => result.programVersionId === bundle.version.id,
  )
  const latestPeriodEnd =
    currentResults.length === 0
      ? null
      : currentResults.reduce(
          (latest, result) => (result.periodEnd > latest ? result.periodEnd : latest),
          currentResults[0]!.periodEnd,
        )
  const periods = dueMonthlyPeriods(bundle.version, latestPeriodEnd, now)
  const nextResults = openResultsForPeriods(bundle, periods, deps.id, now)
  if (nextResults.length === 0) return { due: 0, opened: 0 }
  const opened = await deps.repository.appendResults({
    program: bundle.program,
    version: bundle.version,
    results: nextResults,
    at: now,
  })
  return { due: nextResults.length, opened }
}

/**
 * The Program a change command works on, caught up first. The hourly job opens
 * a month's results some time after the month begins, and only for the head
 * version. A change that lands in between would plan from a head that looks a
 * month behind: the version it wrote would close the head before that month
 * ever opened, and the month would have no result. So an active Program gets
 * its due months opened here, as the job would, and is read again.
 *
 * Refuses a missing or ended Program before it writes anything. A scheduled
 * Program is not activated here; it is still a goal that has not started.
 */
export async function loadCaughtUpProgram(
  deps: GoalProgramDependencies,
  actor: GoalActor,
  input: Readonly<{ propertyId: string; programId: string }>,
  now: Date,
): Promise<GoalProgramBundle> {
  const loaded = await loadChangeableProgram(deps, actor, input)
  const { due } = await appendDueResults(deps, loaded, now)
  // Read again whenever a month was due, even if this call wrote none of it:
  // then the job wrote it in between, and the bundle in hand is still behind.
  return due === 0 ? loaded : loadChangeableProgram(deps, actor, input)
}

type ProgramMaintenanceTally = Readonly<{
  activated: number
  scheduledResults: number
  unavailable: number
  failed: number
  /** Why it failed; null when it did not. */
  failureCause: string | null
}>

/**
 * One program's maintenance pass: activate it when due, then open any monthly
 * results that have come due. A failure part-way still reports the work that
 * did land, so the stats never under-count a completed activation.
 */
async function maintainProgram(
  deps: GoalProgramDependencies,
  original: GoalProgramBundle,
  now: Date,
): Promise<ProgramMaintenanceTally> {
  let activated = 0
  let scheduledResults = 0
  try {
    const activation = await activateScheduledProgram(deps, original, now)
    if (activation.kind === 'unavailable') {
      return {
        activated,
        scheduledResults,
        unavailable: 1,
        failed: 0,
        failureCause: null,
      }
    }
    if (activation.kind === 'skipped') {
      return {
        activated,
        scheduledResults,
        unavailable: 0,
        failed: 0,
        failureCause: null,
      }
    }
    const bundle = activation.kind === 'activated' ? activation.bundle : original
    if (activation.kind === 'activated') {
      activated = 1
      scheduledResults = activation.scheduledResults
    }
    scheduledResults += (await appendDueResults(deps, bundle, now)).opened
    return { activated, scheduledResults, unavailable: 0, failed: 0, failureCause: null }
  } catch (error) {
    return {
      activated,
      scheduledResults,
      unavailable: 0,
      failed: 1,
      failureCause: failureCauseOf(error),
    }
  }
}

type DueResultOutcome =
  | Readonly<{ kind: 'reconciled' | 'closed' | 'denied' | 'stranded' | 'raced' }>
  | Readonly<{ kind: 'failed'; cause: string }>

/**
 * 'closed' also counts as reconciled; the caller tallies both. A result the run
 * lost to another (already closed, so `not_found` for a result that is not due
 * any more, or its compare-and-set lost) was settled by the winner and is not a
 * failure. A result whose references are missing is a failure and names itself.
 */
async function reconcileDueResult(
  reconcile: () => Promise<Readonly<{ status: string }>>,
): Promise<DueResultOutcome> {
  try {
    const updated = await reconcile()
    return { kind: updated.status === 'closed' ? 'closed' : 'reconciled' }
  } catch (error) {
    if (error instanceof GoalResultOutsideWindowError) return { kind: 'stranded' }
    if (error instanceof GoalProgramError) {
      if (error.code === 'forbidden') return { kind: 'denied' }
      if (error.code === 'not_found' || error.code === 'revision_conflict') {
        return { kind: 'raced' }
      }
    }
    return { kind: 'failed', cause: failureCauseOf(error) }
  }
}

type ResultReference = Readonly<{
  organizationId: string
  propertyId: string
  resultId: string
}>

export async function reconcileResult(
  deps: GoalProgramDependencies,
  input: ResultReference,
): Promise<GoalMonthlyResult> {
  const result = await deps.repository.getDueResult(
    input.organizationId,
    input.propertyId,
    input.resultId,
    deps.now(),
  )
  if (!result) throw new GoalProgramError('not_found')
  await deps.policy.authorize({
    actor: 'system',
    organizationId: result.organizationId,
    propertyId: result.propertyId,
    action: 'goal.update',
  })
  const [program, assignment, version] = await Promise.all([
    deps.repository.get(result.organizationId, result.propertyId, result.programId),
    deps.repository.getAssignment(
      result.organizationId,
      result.propertyId,
      result.assignmentId,
    ),
    deps.repository.getVersion(
      result.organizationId,
      result.propertyId,
      result.programVersionId,
    ),
  ])
  if (!program || !assignment || !version) throw new GoalResultReferenceMissingError()
  if (isOutsideItsWindow(result, assignment, version)) {
    throw new GoalResultOutsideWindowError()
  }
  // Pausing or ending stops future period materialization, but an already
  // opened month remains evidence that must reconcile and close. Otherwise
  // a mid-lifecycle status change would strand an immutable result forever.
  if (program.program.status === 'scheduled') {
    throw new GoalProgramError('invalid_transition')
  }
  const reading = await deps.metrics.queryGoalMetric({
    organizationId: toOrganizationId(result.organizationId),
    propertyId: toPropertyId(result.propertyId),
    definitionVersionId: version.metricDefinitionVersionId,
    subject: metricSubject(assignment.subject),
    periodStart: result.periodStart,
    periodEnd: result.periodEnd,
  })
  const evaluation = evaluationFromGovernedRead(
    version.metric,
    effectiveMonthTarget(result, version),
    reading,
  )
  const now = deps.now()
  const close =
    result.status === 'reconciling' &&
    evaluation.state !== 'updating' &&
    reading.sourceCompleteThrough !== null &&
    isGoalResultReadyToClose({
      periodEnd: result.periodEnd,
      now,
      sourceWatermark: reading.sourceCompleteThrough,
    })
  const next: GoalMonthlyResult = {
    ...result,
    status: close ? 'closed' : 'reconciling',
    evaluation,
    sourceCompleteThrough: reading.sourceCompleteThrough,
    evaluationWatermark: now,
    closedAt: close ? now : null,
    updatedAt: now,
  }
  const updated = await deps.repository.updateResult({
    result: next,
    expectedStatus: result.status,
  })
  if (!updated) throw new GoalProgramError('revision_conflict')
  return updated
}

export async function reconcileClosedResult(
  deps: GoalProgramDependencies,
  input: ResultReference,
) {
  const head = await deps.repository.getClosedResult(
    input.organizationId,
    input.propertyId,
    input.resultId,
  )
  if (!head) throw new GoalProgramError('not_found')
  await deps.policy.authorize({
    actor: 'system',
    organizationId: head.result.organizationId,
    propertyId: head.result.propertyId,
    action: 'goal.update',
  })
  const [assignment, version] = await Promise.all([
    deps.repository.getAssignment(
      head.result.organizationId,
      head.result.propertyId,
      head.result.assignmentId,
    ),
    deps.repository.getVersion(
      head.result.organizationId,
      head.result.propertyId,
      head.result.programVersionId,
    ),
  ])
  if (!assignment || !version) throw new GoalProgramError('not_found')
  const reading = await deps.metrics.queryGoalMetric({
    organizationId: toOrganizationId(head.result.organizationId),
    propertyId: toPropertyId(head.result.propertyId),
    definitionVersionId: version.metricDefinitionVersionId,
    subject: metricSubject(assignment.subject),
    periodStart: head.result.periodStart,
    periodEnd: head.result.periodEnd,
  })
  // A correction consumer can temporarily make the source incomplete.
  // Closed evidence is last-safe and must not be replaced by an updating
  // placeholder; a later retry will append the settled revision.
  if (reading.state === 'updating') {
    return { status: 'pending' as const, result: head.result }
  }
  // The closed row is frozen, so the target it closed against is still there.
  const evaluation = evaluationFromGovernedRead(
    version.metric,
    effectiveMonthTarget(head.result, version),
    reading,
  )
  if (
    sameGoalEvaluation(head.result.evaluation, evaluation) &&
    sameInstant(head.result.sourceCompleteThrough, reading.sourceCompleteThrough)
  ) {
    return { status: 'unchanged' as const, result: head.result }
  }
  const now = deps.now()
  const revised = await deps.repository.appendResultRevision({
    head,
    revisionId: deps.id(),
    evaluation,
    sourceCompleteThrough: reading.sourceCompleteThrough,
    evaluationWatermark: now,
    changeReason: 'metric_correction_reconciliation',
    createdBy: 'system',
    at: now,
  })
  if (revised.status === 'conflict') {
    throw new GoalProgramError('revision_conflict')
  }
  return revised
}

export async function maintain(
  deps: GoalProgramDependencies,
): Promise<GoalProgramMaintenanceStats> {
  const now = deps.now()
  const operational = await deps.repository.listOperational()
  let activated = 0
  let scheduledResults = 0
  let reconciled = 0
  let closed = 0
  let denied = 0
  let unavailable = 0
  let stranded = 0
  let raced = 0
  let failed = 0
  const failureCauses = new Map<string, number>()
  const recordFailure = (cause: string) => {
    failed++
    failureCauses.set(cause, (failureCauses.get(cause) ?? 0) + 1)
  }

  for (const original of operational) {
    if (!(await maintenanceAuthorized(deps, original))) {
      denied++
      continue
    }
    const tally = await maintainProgram(deps, original, now)
    activated += tally.activated
    scheduledResults += tally.scheduledResults
    unavailable += tally.unavailable
    if (tally.failureCause !== null) recordFailure(tally.failureCause)
  }

  const due = await deps.repository.listDueResults(now)
  for (const result of due) {
    const outcome = await reconcileDueResult(() =>
      reconcileResult(deps, {
        organizationId: result.organizationId,
        propertyId: result.propertyId,
        resultId: result.id,
      }),
    )
    if (outcome.kind === 'failed') recordFailure(outcome.cause)
    else if (outcome.kind === 'denied') denied++
    else if (outcome.kind === 'stranded') stranded++
    else if (outcome.kind === 'raced') raced++
    else {
      reconciled++
      if (outcome.kind === 'closed') closed++
    }
  }

  const stats = {
    inspected: operational.length,
    activated,
    scheduledResults,
    reconciled,
    closed,
    denied,
    unavailable,
    stranded,
    raced,
    failed,
    failureCauses: Object.fromEntries(failureCauses),
  }
  if (failed > 0) throw new GoalProgramMaintenanceError(stats)
  return stats
}
