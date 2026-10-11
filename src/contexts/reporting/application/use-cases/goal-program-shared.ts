// Goal Program use cases — the pieces every command module shares.
//
// A leaf among the Goal Program modules: it imports none of goal-programs.ts,
// goal-program-maintenance.ts or goal-program-assignment-changes.ts (only
// types from query-goal-metric.ts), so all three can depend on it without a
// cycle. It holds the service's dependency types, its error, and the pure
// builders and resolvers that more than one command uses.
import {
  METRIC_VERSION_IDS,
  type GovernedMetricVersion,
} from '../../domain/metric-registry'
import type {
  GovernedGoalMetricQuery,
  GovernedGoalMetricResult,
} from './query-goal-metric'
import {
  organizationId as toOrganizationId,
  portalGroupId as toPortalGroupId,
  portalId as toPortalId,
  propertyId as toPropertyId,
} from '#/shared/domain/ids'
import type {
  GoalMonthlyResult,
  GoalProgramBundle,
  GoalProgramRepository,
  GoalProgramVersion,
  GoalSubjectAssignment,
} from '../ports/goal-program.repository'
import {
  firstFullMonthlyPeriodAtOrAfter,
  goalSubjectIdentity,
  minimumSampleForGoalMetric,
  validateGoalTarget,
  type GoalMetric,
  type GoalSubject,
} from '../../domain/goal-program'
import type { PermissionAuthorityContext } from '#/shared/domain/permissions'

export type GoalActor = Readonly<{
  organizationId: string
  userId: string
}> &
  PermissionAuthorityContext

export type GoalExecutionPolicy = Readonly<{
  authorize(
    input: Readonly<{
      actor: GoalActor | 'system'
      organizationId: string
      propertyId: string
      action: 'goal.read' | 'goal.create' | 'goal.update' | 'goal.cancel'
    }>,
  ): Promise<void>
}>

export type GoalMetricReadPort = Readonly<{
  queryGoalMetric: (query: GovernedGoalMetricQuery) => Promise<GovernedGoalMetricResult>
  getApprovedGoalVersion?: (
    definitionVersionId: string,
  ) => Promise<GovernedMetricVersion | null>
}>

const GOAL_METRIC_VERSION_IDS: Readonly<Record<GoalMetric, string>> = {
  qualified_scans: METRIC_VERSION_IDS.qualifiedScanGoal,
  portal_rating_count: METRIC_VERSION_IDS.portalRatingCountGoal,
  portal_rating_average: METRIC_VERSION_IDS.portalRatingAverageGoal,
}

export type GoalProgramSubjectReader = Readonly<{
  getTimezone(organizationId: string, propertyId: string): Promise<string | null>
  subjectBelongsToProperty(
    organizationId: string,
    propertyId: string,
    subject: GoalSubject,
  ): Promise<boolean>
  /**
   * Returns a bounded request-time snapshot. The result is never persisted as
   * a selector and therefore cannot assign Portals created after this call.
   */
  listCurrentPortalIds(
    organizationId: string,
    propertyId: string,
    limit: number,
  ): Promise<readonly string[]>
}>

export type GoalProgramDependencies = Readonly<{
  repository: GoalProgramRepository
  policy: GoalExecutionPolicy
  subjects: GoalProgramSubjectReader
  metrics: GoalMetricReadPort
  id: () => string
  now: () => Date
}>

export class GoalProgramError extends Error {
  constructor(
    readonly code:
      | 'forbidden'
      | 'not_found'
      | 'invalid_name'
      | 'invalid_target'
      | 'invalid_subject'
      | 'duplicate_subject'
      | 'assignment_limit_exceeded'
      | 'invalid_reason'
      | 'metric_unavailable'
      | 'invalid_transition'
      | 'revision_conflict'
      | 'subject_has_goal'
      | 'start_month_changed',
  ) {
    super(code)
    this.name = 'GoalProgramError'
  }
}

/**
 * The earliest instant a revision may start: after the request, and never
 * before a month that still has to reconcile ends. That month belongs to the
 * current version's timezone; the next month in a Property timezone further
 * east starts before it ends, and closing the version there would leave the
 * month outside its version window, where the database refuses every update.
 */
export function earliestRevisionStart(
  results: readonly GoalMonthlyResult[],
  now: Date,
): Date {
  // One millisecond on: a revision never redefines a month already in
  // progress, even when the request lands exactly on its first instant.
  const earliest = results
    .filter((result) => result.status === 'open' || result.status === 'reconciling')
    .reduce(
      (latest, result) => Math.max(latest, result.periodEnd.getTime()),
      now.getTime() + 1,
    )
  return new Date(earliest)
}

/**
 * The Program a command is about to change: it must exist for the actor's
 * organization and Property, and an ended Program takes no further change.
 */
export async function loadChangeableProgram(
  deps: GoalProgramDependencies,
  actor: GoalActor,
  input: Readonly<{ propertyId: string; programId: string }>,
): Promise<GoalProgramBundle> {
  const current = await deps.repository.get(
    actor.organizationId,
    input.propertyId,
    input.programId,
  )
  if (!current) throw new GoalProgramError('not_found')
  if (current.program.status === 'ended') {
    throw new GoalProgramError('invalid_transition')
  }
  return current
}

export function assignmentFor(
  input: Readonly<{
    id: string
    programId: string
    programVersionId: string
    organizationId: string
    propertyId: string
    metric: GoalMetric
    subject: GoalSubject
    effectiveFrom: Date
    effectiveTo: Date | null
    actorId: string
    at: Date
  }>,
): GoalSubjectAssignment {
  return {
    id: input.id,
    programId: input.programId,
    programVersionId: input.programVersionId,
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    metric: input.metric,
    subject: input.subject,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    createdBy: input.actorId,
    createdAt: input.at,
  }
}

export function metricSubject(subject: GoalSubject): GovernedGoalMetricQuery['subject'] {
  switch (subject.kind) {
    case 'property':
      return { kind: 'property', propertyId: toPropertyId(subject.propertyId) }
    case 'portal_group':
      return {
        kind: 'portal_group',
        portalGroupId: toPortalGroupId(subject.portalGroupId),
      }
    case 'portal':
      return { kind: 'portal', portalId: toPortalId(subject.portalId) }
  }
}

export function openResultFor(
  assignment: GoalSubjectAssignment,
  period: Readonly<{ start: Date; end: Date }>,
  timezone: string,
  id: string,
  at: Date,
): GoalMonthlyResult {
  return {
    id,
    assignmentId: assignment.id,
    programId: assignment.programId,
    programVersionId: assignment.programVersionId,
    organizationId: assignment.organizationId,
    propertyId: assignment.propertyId,
    periodStart: period.start,
    periodEnd: period.end,
    propertyTimezone: timezone,
    status: 'open',
    targetValue: null,
    evaluation: {
      state: 'updating',
      value: null,
      sampleCount: 0,
      achieved: null,
      reason: 'period_open',
    },
    sourceCompleteThrough: null,
    evaluationWatermark: null,
    closedAt: null,
    createdAt: at,
    updatedAt: at,
  }
}

export function dueMonthlyPeriods(
  version: GoalProgramVersion,
  latestPeriodEnd: Date | null,
  now: Date,
): readonly Readonly<{ start: Date; end: Date }>[] {
  const periods: Readonly<{ start: Date; end: Date }>[] = []
  let period = firstFullMonthlyPeriodAtOrAfter(
    latestPeriodEnd ?? version.effectiveFrom,
    version.propertyTimezone,
  )

  // A bounded catch-up protects the worker from corrupt temporal data while
  // still recovering up to a decade of missed monthly schedules. Exceeding
  // the bound fails visibly so the job cannot silently leave a partial gap.
  while (period.start <= now) {
    if (periods.length >= 120) {
      throw new Error('Goal Program monthly catch-up exceeds safety bound')
    }
    if (version.effectiveTo !== null && period.end > version.effectiveTo) break
    periods.push(period)
    period = firstFullMonthlyPeriodAtOrAfter(period.end, version.propertyTimezone)
  }
  return periods
}

export function openResultsForPeriods(
  bundle: GoalProgramBundle,
  periods: readonly Readonly<{ start: Date; end: Date }>[],
  id: () => string,
  at: Date,
): readonly GoalMonthlyResult[] {
  return periods.flatMap((period) =>
    bundle.assignments
      .filter(
        (assignment) =>
          assignment.programVersionId === bundle.version.id &&
          assignment.effectiveFrom <= period.start &&
          (assignment.effectiveTo === null || assignment.effectiveTo >= period.end),
      )
      .map((assignment) =>
        openResultFor(assignment, period, bundle.version.propertyTimezone, id(), at),
      ),
  )
}

async function validateSubjects(
  deps: GoalProgramDependencies,
  organizationId: string,
  propertyId: string,
  subjects: readonly GoalSubject[],
): Promise<void> {
  if (subjects.length === 0) throw new GoalProgramError('invalid_subject')
  const identities = subjects.map(goalSubjectIdentity)
  if (new Set(identities).size !== identities.length) {
    throw new GoalProgramError('duplicate_subject')
  }
  const ownership = await Promise.all(
    subjects.map((subject) =>
      deps.subjects.subjectBelongsToProperty(organizationId, propertyId, subject),
    ),
  )
  if (ownership.some((owned) => !owned)) throw new GoalProgramError('invalid_subject')
}

async function resolveMetricVersion(deps: GoalProgramDependencies, metric: GoalMetric) {
  const versionId = GOAL_METRIC_VERSION_IDS[metric]
  const governed = await deps.metrics.getApprovedGoalVersion?.(versionId)
  if (
    !governed ||
    governed.version.id !== versionId ||
    governed.version.minimumSample !== minimumSampleForGoalMetric(metric)
  ) {
    throw new GoalProgramError('metric_unavailable')
  }
  return governed
}

/**
 * Validate a Program definition's target and subjects, and resolve what it is
 * measured under: the Property's timezone and the governed metric version.
 * The first subject is the one its metric's readiness is checked against.
 */
export async function resolveGoalDefinition(
  deps: GoalProgramDependencies,
  organizationId: string,
  input: Readonly<{
    propertyId: string
    metric: GoalMetric
    targetValue: number
    subjects: readonly GoalSubject[]
  }>,
) {
  const target = validateGoalTarget(input.metric, input.targetValue)
  if (!target.ok) throw new GoalProgramError('invalid_target')
  const [timezone, governed] = await Promise.all([
    deps.subjects.getTimezone(organizationId, input.propertyId),
    resolveMetricVersion(deps, input.metric),
    validateSubjects(deps, organizationId, input.propertyId, input.subjects),
  ])
  if (!timezone) throw new GoalProgramError('not_found')
  const readinessSubject = input.subjects[0]
  if (!readinessSubject) throw new GoalProgramError('invalid_subject')
  return { target, timezone, governed, readinessSubject }
}

/**
 * True when the metric's source is not active yet for the version's first
 * month. A source that is active but unavailable or quarantined refuses it.
 */
export async function isMetricSourceInactive(
  deps: GoalProgramDependencies,
  query: Readonly<{
    organizationId: string
    propertyId: string
    governed: GovernedMetricVersion
    subject: GoalSubject
    period: Readonly<{ start: Date; end: Date }>
  }>,
): Promise<boolean> {
  const readiness = await deps.metrics.queryGoalMetric({
    organizationId: toOrganizationId(query.organizationId),
    propertyId: toPropertyId(query.propertyId),
    definitionVersionId: query.governed.version.id,
    subject: metricSubject(query.subject),
    periodStart: query.period.start,
    periodEnd: query.period.end,
  })
  const sourceInactive = readiness.reason === 'metric_source_not_active'
  if (!sourceInactive && ['unavailable', 'quarantined'].includes(readiness.state)) {
    throw new GoalProgramError('metric_unavailable')
  }
  return sourceInactive
}
