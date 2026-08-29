import { METRIC_VERSION_IDS } from '#/contexts/metric/application/public-api'
import type {
  GovernedGoalMetricQuery,
  GovernedGoalMetricResult,
  MetricPublicApi,
} from '#/contexts/metric/application/public-api'
import {
  organizationId as toOrganizationId,
  portalGroupId as toPortalGroupId,
  portalId as toPortalId,
  propertyId as toPropertyId,
} from '#/shared/domain/ids'
import type { GoalActor, GoalExecutionPolicy } from '../ports/goal-execution-policy'
import type {
  GoalMonthlyResult,
  GoalProgramBundle,
  GoalProgramRepository,
  GoalProgramVersion,
  GoalSubjectAssignment,
} from '../ports/goal-program.repository'
import {
  canTransitionGoalProgram,
  evaluateGoalMetric,
  firstFullMonthlyPeriodAtOrAfter,
  goalSubjectIdentity,
  isGoalResultReadyToClose,
  MAX_GOAL_ASSIGNMENT_SELECTIONS,
  minimumSampleForGoalMetric,
  validateGoalTarget,
  type GoalMetric,
  type GoalMetricEvaluation,
  type GoalProgramStatus,
  type GoalSubject,
} from '../../domain/goal-program'

export { MAX_GOAL_ASSIGNMENT_SELECTIONS } from '../../domain/goal-program'

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
  metrics: MetricPublicApi
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
      | 'revision_conflict',
  ) {
    super(code)
    this.name = 'GoalProgramError'
  }
}

export type GoalAssignmentChangeOutcomeCode =
  | 'added'
  | 'removed'
  | 'already_assigned'
  | 'not_assigned'
  | 'duplicate'
  | 'conflicting_operations'
  | 'invalid_subject'
  | 'overlap'
  | 'last_assignment_required'

export type GoalAssignmentChangeOutcome = Readonly<{
  operation: 'add' | 'remove'
  source: 'explicit' | 'all_current_portals'
  subject: GoalSubject
  outcome: GoalAssignmentChangeOutcomeCode
}>

export type GoalAssignmentChangeResult = Readonly<{
  programId: string
  previousVersion: number
  currentVersion: number
  effectiveFrom: Date | null
  selectedAt: Date
  selectedCurrentPortalCount: number
  outcomes: readonly GoalAssignmentChangeOutcome[]
}>

export type GoalProgramMaintenanceStats = Readonly<{
  inspected: number
  activated: number
  scheduledResults: number
  reconciled: number
  closed: number
  denied: number
  unavailable: number
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

function assignmentFor(
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

function metricSubject(subject: GoalSubject): GovernedGoalMetricQuery['subject'] {
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

function openResultFor(
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

function dueMonthlyPeriods(
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

function openResultsForPeriods(
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

export function createGoalProgramService(deps: GoalProgramDependencies) {
  const serviceMethods = {
    create: async (
      input: Readonly<{
        propertyId: string
        name: string
        description?: string | null
        metric: GoalMetric
        targetValue: number
        subjects: readonly GoalSubject[]
      }>,
      actor: GoalActor,
    ): Promise<GoalProgramBundle> => {
      await deps.policy.authorize({
        actor,
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        action: 'goal.create',
      })
      const name = input.name.trim()
      if (!name) throw new GoalProgramError('invalid_name')
      const target = validateGoalTarget(input.metric, input.targetValue)
      if (!target.ok) throw new GoalProgramError('invalid_target')
      const [timezone, governed] = await Promise.all([
        deps.subjects.getTimezone(actor.organizationId, input.propertyId),
        resolveMetricVersion(deps, input.metric),
        validateSubjects(deps, actor.organizationId, input.propertyId, input.subjects),
      ])
      if (!timezone) throw new GoalProgramError('not_found')
      const readinessSubject = input.subjects[0]
      if (!readinessSubject) throw new GoalProgramError('invalid_subject')

      const now = deps.now()
      const period = firstFullMonthlyPeriodAtOrAfter(now, timezone)
      const readiness = await deps.metrics.queryGoalMetric({
        organizationId: toOrganizationId(actor.organizationId),
        propertyId: toPropertyId(input.propertyId),
        definitionVersionId: governed.version.id,
        subject: metricSubject(readinessSubject),
        periodStart: period.start,
        periodEnd: period.end,
      })
      const sourceInactive = readiness.reason === 'metric_source_not_active'
      if (!sourceInactive && ['unavailable', 'quarantined'].includes(readiness.state)) {
        throw new GoalProgramError('metric_unavailable')
      }
      const programId = deps.id()
      const versionId = deps.id()
      const status: GoalProgramStatus =
        sourceInactive || period.start > now ? 'scheduled' : 'active'
      const program = {
        id: programId,
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        name,
        description: input.description?.trim() || null,
        status,
        statusReason: sourceInactive
          ? 'metric_source_not_active'
          : status === 'scheduled'
            ? 'awaiting_first_full_month'
            : null,
        currentVersion: 1,
        createdBy: actor.userId,
        createdAt: now,
        updatedAt: now,
      } as const
      const version: GoalProgramVersion = {
        id: versionId,
        programId,
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        version: 1,
        metricDefinitionId: governed.definition.id,
        metricDefinitionVersionId: governed.version.id,
        metric: input.metric,
        metricMinimumSample: governed.version.minimumSample,
        targetValue: target.normalizedTarget,
        propertyTimezone: timezone,
        effectiveFrom: period.start,
        effectiveTo: null,
        changeReason: 'created',
        createdBy: actor.userId,
        createdAt: now,
      }
      const assignments = input.subjects.map((subject) =>
        assignmentFor({
          id: deps.id(),
          programId,
          programVersionId: versionId,
          organizationId: actor.organizationId,
          propertyId: input.propertyId,
          metric: input.metric,
          subject,
          effectiveFrom: period.start,
          effectiveTo: null,
          actorId: actor.userId,
          at: now,
        }),
      )
      const results =
        status === 'active'
          ? assignments.map((assignment) =>
              openResultFor(assignment, period, timezone, deps.id(), now),
            )
          : []
      const bundle: GoalProgramBundle = {
        program,
        version,
        versions: [version],
        assignments,
        results,
      }
      await deps.repository.create({
        bundle,
        auditAction: 'goal.program.created',
        outboxEventId: deps.id(),
      })
      return bundle
    },

    get: async (
      input: Readonly<{ propertyId: string; programId: string }>,
      actor: GoalActor,
    ) => {
      await deps.policy.authorize({
        actor,
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        action: 'goal.read',
      })
      const bundle = await deps.repository.get(
        actor.organizationId,
        input.propertyId,
        input.programId,
      )
      if (!bundle) throw new GoalProgramError('not_found')
      return bundle
    },

    list: async (propertyId: string, actor: GoalActor) => {
      await deps.policy.authorize({
        actor,
        organizationId: actor.organizationId,
        propertyId,
        action: 'goal.read',
      })
      return deps.repository.list(actor.organizationId, propertyId)
    },

    revise: async (
      input: Readonly<{
        propertyId: string
        programId: string
        metric: GoalMetric
        targetValue: number
        subjects: readonly GoalSubject[]
        reason: string
      }>,
      actor: GoalActor,
    ): Promise<GoalProgramBundle> => {
      await deps.policy.authorize({
        actor,
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        action: 'goal.update',
      })
      const current = await deps.repository.get(
        actor.organizationId,
        input.propertyId,
        input.programId,
      )
      if (!current) throw new GoalProgramError('not_found')
      if (current.program.status === 'ended') {
        throw new GoalProgramError('invalid_transition')
      }
      const now = deps.now()
      // A future Program head is already the one pending revision that the
      // maintenance runtime will activate. Stacking another future head would
      // either create a zero-length version or skip the pending version.
      if (current.version.effectiveFrom > now) {
        throw new GoalProgramError('revision_conflict')
      }
      const target = validateGoalTarget(input.metric, input.targetValue)
      if (!target.ok) throw new GoalProgramError('invalid_target')
      const [timezone, governed] = await Promise.all([
        deps.subjects.getTimezone(actor.organizationId, input.propertyId),
        resolveMetricVersion(deps, input.metric),
        validateSubjects(deps, actor.organizationId, input.propertyId, input.subjects),
      ])
      if (!timezone) throw new GoalProgramError('not_found')
      const readinessSubject = input.subjects[0]
      if (!readinessSubject) throw new GoalProgramError('invalid_subject')
      // Revisions never redefine a month already in progress, even when the
      // request lands exactly on its first instant.
      const period = firstFullMonthlyPeriodAtOrAfter(
        new Date(now.getTime() + 1),
        timezone,
      )
      const readiness = await deps.metrics.queryGoalMetric({
        organizationId: toOrganizationId(actor.organizationId),
        propertyId: toPropertyId(input.propertyId),
        definitionVersionId: governed.version.id,
        subject: metricSubject(readinessSubject),
        periodStart: period.start,
        periodEnd: period.end,
      })
      const sourceInactive = readiness.reason === 'metric_source_not_active'
      if (!sourceInactive && ['unavailable', 'quarantined'].includes(readiness.state)) {
        throw new GoalProgramError('metric_unavailable')
      }
      if (sourceInactive && current.program.status !== 'scheduled') {
        throw new GoalProgramError('metric_unavailable')
      }

      const versionId = deps.id()
      const version: GoalProgramVersion = {
        id: versionId,
        programId: current.program.id,
        organizationId: current.program.organizationId,
        propertyId: current.program.propertyId,
        version: current.version.version + 1,
        metricDefinitionId: governed.definition.id,
        metricDefinitionVersionId: governed.version.id,
        metric: input.metric,
        metricMinimumSample: governed.version.minimumSample,
        targetValue: target.normalizedTarget,
        propertyTimezone: timezone,
        effectiveFrom: period.start,
        effectiveTo: null,
        changeReason: input.reason.trim() || 'revised',
        createdBy: actor.userId,
        createdAt: now,
      }
      const assignments = input.subjects.map((subject) =>
        assignmentFor({
          id: deps.id(),
          programId: current.program.id,
          programVersionId: versionId,
          organizationId: current.program.organizationId,
          propertyId: current.program.propertyId,
          metric: input.metric,
          subject,
          effectiveFrom: period.start,
          effectiveTo: null,
          actorId: actor.userId,
          at: now,
        }),
      )
      const revised = await deps.repository.revise({
        expectedVersion: current.version,
        version,
        assignments,
        actorId: actor.userId,
        at: now,
        outboxEventId: deps.id(),
      })
      if (!revised) throw new GoalProgramError('revision_conflict')
      return {
        program: { ...current.program, currentVersion: version.version, updatedAt: now },
        version,
        versions: [...current.versions, version],
        assignments: [...current.assignments, ...assignments],
        results: current.results,
      }
    },

    changeAssignments: async (
      input: Readonly<{
        propertyId: string
        programId: string
        expectedVersion: number
        add: readonly GoalSubject[]
        remove: readonly GoalSubject[]
        selectAllCurrentPortals: boolean
        reason: string
      }>,
      actor: GoalActor,
    ): Promise<GoalAssignmentChangeResult> => {
      await deps.policy.authorize({
        actor,
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        action: 'goal.update',
      })
      if (input.add.length + input.remove.length > MAX_GOAL_ASSIGNMENT_SELECTIONS) {
        throw new GoalProgramError('assignment_limit_exceeded')
      }
      if (
        input.add.length === 0 &&
        input.remove.length === 0 &&
        !input.selectAllCurrentPortals
      ) {
        throw new GoalProgramError('invalid_subject')
      }
      const reason = input.reason.trim()
      if (!reason || reason.length > 500) throw new GoalProgramError('invalid_reason')

      const current = await deps.repository.get(
        actor.organizationId,
        input.propertyId,
        input.programId,
      )
      if (!current) throw new GoalProgramError('not_found')
      if (current.program.status === 'ended') {
        throw new GoalProgramError('invalid_transition')
      }
      if (current.version.version !== input.expectedVersion) {
        throw new GoalProgramError('revision_conflict')
      }

      const selectedAt = deps.now()
      if (current.version.effectiveFrom > selectedAt) {
        throw new GoalProgramError('revision_conflict')
      }
      const currentPortalIds = input.selectAllCurrentPortals
        ? await deps.subjects.listCurrentPortalIds(
            actor.organizationId,
            input.propertyId,
            MAX_GOAL_ASSIGNMENT_SELECTIONS + 1,
          )
        : []
      if (
        currentPortalIds.length > MAX_GOAL_ASSIGNMENT_SELECTIONS ||
        input.add.length + input.remove.length + currentPortalIds.length >
          MAX_GOAL_ASSIGNMENT_SELECTIONS
      ) {
        throw new GoalProgramError('assignment_limit_exceeded')
      }

      type Selection = Readonly<{
        operation: 'add' | 'remove'
        source: GoalAssignmentChangeOutcome['source']
        subject: GoalSubject
      }>
      const selections: readonly Selection[] = [
        ...input.add.map((subject): Selection => ({
          operation: 'add',
          source: 'explicit',
          subject,
        })),
        ...currentPortalIds.map((portalId): Selection => ({
          operation: 'add',
          source: 'all_current_portals',
          subject: { kind: 'portal', portalId },
        })),
        ...input.remove.map((subject): Selection => ({
          operation: 'remove',
          source: 'explicit',
          subject,
        })),
      ]
      const operationByIdentity = new Map<string, Set<Selection['operation']>>()
      for (const selection of selections) {
        const identity = goalSubjectIdentity(selection.subject)
        const operations = operationByIdentity.get(identity) ?? new Set()
        operations.add(selection.operation)
        operationByIdentity.set(identity, operations)
      }
      const seen = new Set<string>()
      const preliminary = selections.map((selection) => {
        const identity = goalSubjectIdentity(selection.subject)
        const occurrence = `${selection.operation}:${identity}`
        const outcome =
          operationByIdentity.get(identity)?.size === 2
            ? ('conflicting_operations' as const)
            : seen.has(occurrence)
              ? ('duplicate' as const)
              : null
        seen.add(occurrence)
        return { ...selection, identity, outcome }
      })
      const ownership = await Promise.all(
        preliminary.map((selection) =>
          selection.outcome
            ? Promise.resolve(true)
            : deps.subjects.subjectBelongsToProperty(
                actor.organizationId,
                input.propertyId,
                selection.subject,
              ),
        ),
      )
      const currentAssignments = current.assignments.filter(
        (assignment) => assignment.programVersionId === current.version.id,
      )
      if (currentAssignments.length === 0) {
        throw new GoalProgramError('invalid_subject')
      }
      const currentByIdentity = new Map(
        currentAssignments.map((assignment) => [
          goalSubjectIdentity(assignment.subject),
          assignment.subject,
        ]),
      )
      const effectiveFrom = firstFullMonthlyPeriodAtOrAfter(
        new Date(selectedAt.getTime() + 1),
        current.version.propertyTimezone,
      ).start
      const additionsToCheck = preliminary.flatMap((selection, index) => {
        if (
          selection.outcome ||
          !ownership[index] ||
          selection.operation !== 'add' ||
          currentByIdentity.has(selection.identity)
        ) {
          return []
        }
        return [selection.subject]
      })
      const conflictingSubjects =
        additionsToCheck.length === 0
          ? []
          : await deps.repository.findAssignmentConflicts({
              organizationId: actor.organizationId,
              propertyId: input.propertyId,
              excludeProgramId: current.program.id,
              metric: current.version.metric,
              effectiveFrom,
              subjects: additionsToCheck,
            })
      const overlapping = new Set(conflictingSubjects.map(goalSubjectIdentity))
      const nextByIdentity = new Map(currentByIdentity)
      let changed = false
      let outcomes: GoalAssignmentChangeOutcome[] = preliminary.map(
        (selection, index): GoalAssignmentChangeOutcome => {
          const result = (
            outcome: GoalAssignmentChangeOutcomeCode,
          ): GoalAssignmentChangeOutcome => ({
            operation: selection.operation,
            source: selection.source,
            subject: selection.subject,
            outcome,
          })
          if (selection.outcome) {
            return result(selection.outcome)
          }
          if (!ownership[index]) {
            return result('invalid_subject')
          }
          if (selection.operation === 'add') {
            if (nextByIdentity.has(selection.identity)) {
              return result('already_assigned')
            }
            if (overlapping.has(selection.identity)) {
              return result('overlap')
            }
            nextByIdentity.set(selection.identity, selection.subject)
            changed = true
            return result('added')
          }
          if (!nextByIdentity.has(selection.identity)) {
            return result('not_assigned')
          }
          nextByIdentity.delete(selection.identity)
          changed = true
          return result('removed')
        },
      )

      if (nextByIdentity.size === 0) {
        outcomes = outcomes.map((outcome) =>
          outcome.outcome === 'removed'
            ? { ...outcome, outcome: 'last_assignment_required' }
            : outcome,
        )
        changed = false
      }
      if (nextByIdentity.size > MAX_GOAL_ASSIGNMENT_SELECTIONS) {
        throw new GoalProgramError('assignment_limit_exceeded')
      }
      if (!changed) {
        return {
          programId: current.program.id,
          previousVersion: current.version.version,
          currentVersion: current.version.version,
          effectiveFrom: null,
          selectedAt,
          selectedCurrentPortalCount: currentPortalIds.length,
          outcomes,
        }
      }

      const versionId = deps.id()
      const version: GoalProgramVersion = {
        ...current.version,
        id: versionId,
        version: current.version.version + 1,
        effectiveFrom,
        effectiveTo: null,
        changeReason: reason,
        createdBy: actor.userId,
        createdAt: selectedAt,
      }
      const assignments = [...nextByIdentity.values()].map((subject) =>
        assignmentFor({
          id: deps.id(),
          programId: current.program.id,
          programVersionId: versionId,
          organizationId: actor.organizationId,
          propertyId: input.propertyId,
          metric: current.version.metric,
          subject,
          effectiveFrom,
          effectiveTo: null,
          actorId: actor.userId,
          at: selectedAt,
        }),
      )
      const revised = await deps.repository.revise({
        expectedVersion: current.version,
        version,
        assignments,
        actorId: actor.userId,
        at: selectedAt,
        outboxEventId: deps.id(),
      })
      if (!revised) throw new GoalProgramError('revision_conflict')
      return {
        programId: current.program.id,
        previousVersion: current.version.version,
        currentVersion: version.version,
        effectiveFrom,
        selectedAt,
        selectedCurrentPortalCount: currentPortalIds.length,
        outcomes,
      }
    },

    changeStatus: async (
      input: Readonly<{
        propertyId: string
        programId: string
        status: GoalProgramStatus
        reason: string
      }>,
      actor: GoalActor,
    ) => {
      await deps.policy.authorize({
        actor,
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        action: input.status === 'ended' ? 'goal.cancel' : 'goal.update',
      })
      const current = await deps.repository.get(
        actor.organizationId,
        input.propertyId,
        input.programId,
      )
      if (!current) throw new GoalProgramError('not_found')
      if (!canTransitionGoalProgram(current.program.status, input.status)) {
        throw new GoalProgramError('invalid_transition')
      }
      if (
        current.program.status === 'scheduled' &&
        input.status === 'active' &&
        (deps.now() < current.version.effectiveFrom || current.results.length === 0)
      ) {
        throw new GoalProgramError('metric_unavailable')
      }
      const updated = await deps.repository.changeStatus({
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        programId: input.programId,
        expectedStatus: current.program.status,
        status: input.status,
        reason: input.reason.trim() || 'status_changed',
        actorId: actor.userId,
        at: deps.now(),
        outboxEventId: deps.id(),
      })
      if (!updated) throw new GoalProgramError('revision_conflict')
      return updated
    },

    reconcileResult: async (
      input: Readonly<{
        organizationId: string
        propertyId: string
        resultId: string
      }>,
    ): Promise<GoalMonthlyResult> => {
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
    },

    reconcileClosedResult: async (
      input: Readonly<{
        organizationId: string
        propertyId: string
        resultId: string
      }>,
    ) => {
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
    },

    maintain: async (): Promise<GoalProgramMaintenanceStats> => {
      const now = deps.now()
      const operational = await deps.repository.listOperational()
      let activated = 0
      let scheduledResults = 0
      let reconciled = 0
      let closed = 0
      let denied = 0
      let unavailable = 0
      let failed = 0

      for (const original of operational) {
        let bundle = original
        try {
          await deps.policy.authorize({
            actor: 'system',
            organizationId: bundle.program.organizationId,
            propertyId: bundle.program.propertyId,
            action: 'goal.update',
          })
        } catch (error) {
          if (error instanceof GoalProgramError && error.code === 'forbidden') {
            denied++
            continue
          }
          throw error
        }

        try {
          if (
            bundle.program.status === 'scheduled' &&
            bundle.version.effectiveFrom <= now
          ) {
            const assignment = bundle.assignments.find(
              (candidate) => candidate.programVersionId === bundle.version.id,
            )
            if (!assignment) {
              unavailable++
              continue
            }
            const periods = dueMonthlyPeriods(bundle.version, null, now)
            const period = periods[0]
            if (!period) continue
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
              unavailable++
              continue
            }
            const newResults = openResultsForPeriods(bundle, periods, deps.id, now)
            const active = await deps.repository.activate({
              bundle,
              results: newResults,
              at: now,
              outboxEventId: deps.id(),
            })
            if (!active) continue
            activated++
            scheduledResults += newResults.length
            bundle = {
              ...bundle,
              program: active,
              results: [...bundle.results, ...newResults],
            }
          }

          if (bundle.program.status !== 'active') continue
          const currentResults = bundle.results.filter(
            (result) => result.programVersionId === bundle.version.id,
          )
          const latestPeriodEnd =
            currentResults.length === 0
              ? null
              : currentResults.reduce(
                  (latest, result) =>
                    result.periodEnd > latest ? result.periodEnd : latest,
                  currentResults[0]!.periodEnd,
                )
          const periods = dueMonthlyPeriods(bundle.version, latestPeriodEnd, now)
          const nextResults = openResultsForPeriods(bundle, periods, deps.id, now)
          if (nextResults.length > 0) {
            scheduledResults += await deps.repository.appendResults({
              program: bundle.program,
              version: bundle.version,
              results: nextResults,
              at: now,
              outboxEventId: deps.id(),
            })
          }
        } catch {
          failed++
        }
      }

      const due = await deps.repository.listDueResults(now)
      for (const result of due) {
        try {
          const updated = await serviceMethods.reconcileResult({
            organizationId: result.organizationId,
            propertyId: result.propertyId,
            resultId: result.id,
          })
          reconciled++
          if (updated.status === 'closed') closed++
        } catch (error) {
          if (error instanceof GoalProgramError && error.code === 'forbidden') denied++
          else failed++
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
        failed,
      }
      if (failed > 0) throw new GoalProgramMaintenanceError(stats)
      return stats
    },
  }

  return serviceMethods
}

export type GoalProgramService = ReturnType<typeof createGoalProgramService>
