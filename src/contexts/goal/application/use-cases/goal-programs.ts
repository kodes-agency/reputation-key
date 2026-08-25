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
import type { GoalExecutionPolicy, GoalActor } from './governed-goals'
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
  minimumSampleForGoalMetric,
  validateGoalTarget,
  type GoalMetric,
  type GoalMetricEvaluation,
  type GoalProgramStatus,
  type GoalSubject,
} from '../../domain/goal-program'

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
      | 'metric_unavailable'
      | 'invalid_transition'
      | 'revision_conflict',
  ) {
    super(code)
    this.name = 'GoalProgramError'
  }
}

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
export class GoalProgramMaintenanceError extends Error {
  constructor(readonly stats: GoalProgramMaintenanceStats) {
    super(`Goal Program maintenance had ${stats.failed} failed operation(s)`)
    this.name = 'GoalProgramMaintenanceError'
  }
}

function requireManager(actor: GoalActor): void {
  if (actor.role !== 'AccountAdmin' && actor.role !== 'PropertyManager') {
    throw new GoalProgramError('forbidden')
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
      requireManager(actor)
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
      const results = sourceInactive
        ? []
        : assignments.map((assignment) =>
            openResultFor(assignment, period, timezone, deps.id(), now),
          )
      const bundle: GoalProgramBundle = { program, version, assignments, results }
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
      requireManager(actor)
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
      const results = sourceInactive
        ? []
        : assignments.map((assignment) =>
            openResultFor(assignment, period, timezone, deps.id(), now),
          )
      await deps.repository.revise({
        expectedVersion: current.version,
        version,
        assignments,
        results,
        actorId: actor.userId,
        at: now,
        outboxEventId: deps.id(),
      })
      return {
        program: { ...current.program, currentVersion: version.version, updatedAt: now },
        version,
        assignments,
        results,
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
      requireManager(actor)
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
      if (program.program.status !== 'active') {
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
        now.getTime() >= result.periodEnd.getTime() + 24 * 60 * 60 * 1_000
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
        outboxEventId: deps.id(),
      })
      if (!updated) throw new GoalProgramError('revision_conflict')
      return updated
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
            const assignment = bundle.assignments[0]
            if (!assignment) {
              unavailable++
              continue
            }
            const period = bundle.results[0]
              ? {
                  start: bundle.results[0].periodStart,
                  end: bundle.results[0].periodEnd,
                }
              : firstFullMonthlyPeriodAtOrAfter(now, bundle.version.propertyTimezone)
            if (period.start > now) continue
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
            const newResults =
              bundle.results.length === 0
                ? bundle.assignments.map((candidate) =>
                    openResultFor(
                      candidate,
                      period,
                      bundle.version.propertyTimezone,
                      deps.id(),
                      now,
                    ),
                  )
                : []
            const active = await deps.repository.activate({
              bundle,
              results: newResults,
              at: now,
              outboxEventId: deps.id(),
            })
            if (!active) continue
            activated++
            bundle = {
              ...bundle,
              program: active,
              results: [...bundle.results, ...newResults],
            }
          }

          if (bundle.program.status !== 'active' || bundle.results.length === 0) {
            continue
          }
          const latest = bundle.results.reduce((candidate, result) =>
            result.periodEnd > candidate.periodEnd ? result : candidate,
          )
          if (now < latest.periodStart) continue
          const nextPeriod = firstFullMonthlyPeriodAtOrAfter(
            latest.periodEnd,
            bundle.version.propertyTimezone,
          )
          const eligibleAssignments = bundle.assignments.filter(
            (assignment) =>
              assignment.effectiveFrom <= nextPeriod.start &&
              (assignment.effectiveTo === null ||
                assignment.effectiveTo >= nextPeriod.end),
          )
          const nextResults = eligibleAssignments.map((assignment) =>
            openResultFor(
              assignment,
              nextPeriod,
              bundle.version.propertyTimezone,
              deps.id(),
              now,
            ),
          )
          scheduledResults += await deps.repository.appendResults({
            program: bundle.program,
            version: bundle.version,
            results: nextResults,
            at: now,
            outboxEventId: deps.id(),
          })
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
