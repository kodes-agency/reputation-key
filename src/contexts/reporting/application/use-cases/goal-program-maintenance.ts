// Goal Program use cases — maintenance: activating scheduled Programs, opening
// the monthly results that have come due, and reconciling and closing them.
//
// These commands run from the hourly maintenance job and the correction
// consumer, not from a request. The service composes them (goal-programs.ts)
// and re-exports the maintenance error so its importers stay where they were.
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
import {
  dueMonthlyPeriods,
  GoalProgramError,
  metricSubject,
  openResultsForPeriods,
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
  failed: number
}>

/**
 * Makes partial maintenance failures visible to BullMQ so its governed retry
 * and quarantine policy can act. The stats are identifier-free and safe to
 * report; individual tenant/program identifiers never cross this boundary.
 */
// Exported although nothing imports it TODAY: this class is thrown OUT of the
// module, and BullMQ's retry policy is meant to act on it. A caller that
// eventually wants to discriminate it should be able to use `instanceof`
// rather than string-matching `error.name`, which is the only handle an
// un-exported class leaves behind.
export class GoalProgramMaintenanceError extends Error {
  constructor(readonly stats: GoalProgramMaintenanceStats) {
    super(`Goal Program maintenance had ${stats.failed} failed operation(s)`)
    this.name = 'GoalProgramMaintenanceError'
  }
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

/** Opens the monthly results that have come due since the latest one, if any. */
async function appendDueResults(
  deps: GoalProgramDependencies,
  bundle: GoalProgramBundle,
  now: Date,
): Promise<number> {
  if (bundle.program.status !== 'active') return 0
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
  if (nextResults.length === 0) return 0
  return deps.repository.appendResults({
    program: bundle.program,
    version: bundle.version,
    results: nextResults,
    at: now,
  })
}

type ProgramMaintenanceTally = Readonly<{
  activated: number
  scheduledResults: number
  unavailable: number
  failed: number
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
      return { activated, scheduledResults, unavailable: 1, failed: 0 }
    }
    if (activation.kind === 'skipped') {
      return { activated, scheduledResults, unavailable: 0, failed: 0 }
    }
    const bundle = activation.kind === 'activated' ? activation.bundle : original
    if (activation.kind === 'activated') {
      activated = 1
      scheduledResults = activation.scheduledResults
    }
    scheduledResults += await appendDueResults(deps, bundle, now)
    return { activated, scheduledResults, unavailable: 0, failed: 0 }
  } catch {
    return { activated, scheduledResults, unavailable: 0, failed: 1 }
  }
}

/** 'closed' also counts as reconciled; the caller tallies both. */
async function reconcileDueResult(
  reconcile: () => Promise<Readonly<{ status: string }>>,
): Promise<'reconciled' | 'closed' | 'denied' | 'stranded' | 'failed'> {
  try {
    const updated = await reconcile()
    return updated.status === 'closed' ? 'closed' : 'reconciled'
  } catch (error) {
    if (error instanceof GoalResultOutsideWindowError) return 'stranded'
    return error instanceof GoalProgramError && error.code === 'forbidden'
      ? 'denied'
      : 'failed'
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
  if (!program || !assignment || !version) throw new GoalProgramError('not_found')
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
    version.targetValue,
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
  const evaluation = evaluationFromGovernedRead(
    version.metric,
    version.targetValue,
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
  let failed = 0

  for (const original of operational) {
    if (!(await maintenanceAuthorized(deps, original))) {
      denied++
      continue
    }
    const tally = await maintainProgram(deps, original, now)
    activated += tally.activated
    scheduledResults += tally.scheduledResults
    unavailable += tally.unavailable
    failed += tally.failed
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
    if (outcome === 'denied') denied++
    else if (outcome === 'stranded') stranded++
    else if (outcome === 'failed') failed++
    else {
      reconciled++
      if (outcome === 'closed') closed++
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
    failed,
  }
  if (failed > 0) throw new GoalProgramMaintenanceError(stats)
  return stats
}
