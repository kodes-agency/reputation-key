import {
  correctionIdempotencyKey,
  evaluateGovernedReading,
  validateGoalDefinition,
  type GoalMeasureKind,
  type GoalScope,
  type GovernedMetricVersion,
  type GovernedReading,
} from '../../domain/governed-goal'
import {
  generatePeriodSequence,
  periodContaining,
  type RecurrenceRule,
} from '../../domain/goal-recurrence'
import type {
  GovernedGoalDefinition,
  GovernedGoalEvaluation,
  GovernedGoalPeriod,
  GovernedGoalRepository,
  GovernedGoalVersion,
} from '../ports/governed-goal.repository'

export type GoalActor = Readonly<{
  organizationId: string
  userId: string
  role: 'AccountAdmin' | 'PropertyManager' | 'Staff'
}>

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

export type GoalPropertyReader = Readonly<{
  getTimezone(organizationId: string, propertyId: string): Promise<string | null>
  portalGroupBelongsToProperty(
    organizationId: string,
    propertyId: string,
    portalGroupId: string,
  ): Promise<boolean>
}>

export type GoalMetricRegistry = Readonly<{
  getApprovedVersion(versionId: string): Promise<GovernedMetricVersion | null>
}>

export type GovernedGoalDependencies = Readonly<{
  repository: GovernedGoalRepository
  policy: GoalExecutionPolicy
  properties: GoalPropertyReader
  metrics: GoalMetricRegistry
  id: () => string
  now: () => Date
}>

export class GovernedGoalError extends Error {
  constructor(
    readonly code:
      | 'forbidden'
      | 'not_found'
      | 'invalid_scope'
      | 'invalid_metric'
      | 'invalid_period'
      | 'inactive'
      | 'version_mismatch'
      | 'reading_out_of_period',
  ) {
    super(code)
    this.name = 'GovernedGoalError'
  }
}

function requireManager(actor: GoalActor): void {
  if (actor.role !== 'AccountAdmin' && actor.role !== 'PropertyManager') {
    throw new GovernedGoalError('forbidden')
  }
}

export function createGovernedGoalService(deps: GovernedGoalDependencies) {
  return {
    create: async (
      input: Readonly<{
        propertyId: string
        scope: GoalScope
        name: string
        description?: string | null
        metricDefinitionVersionId: string
        measureKind: GoalMeasureKind
        targetValue: number
        sourcePolicy: string
        recurrenceRule: RecurrenceRule
      }>,
      actor: GoalActor,
    ): Promise<
      Readonly<{ definition: GovernedGoalDefinition; period: GovernedGoalPeriod }>
    > => {
      requireManager(actor)
      await deps.policy.authorize({
        actor,
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        action: 'goal.create',
      })

      const [timezone, metric] = await Promise.all([
        deps.properties.getTimezone(actor.organizationId, input.propertyId),
        deps.metrics.getApprovedVersion(input.metricDefinitionVersionId),
      ])
      if (!timezone) throw new GovernedGoalError('not_found')
      if (
        input.scope.kind === 'portal_group' &&
        !(await deps.properties.portalGroupBelongsToProperty(
          actor.organizationId,
          input.propertyId,
          input.scope.portalGroupId,
        ))
      ) {
        throw new GovernedGoalError('invalid_scope')
      }
      if (!metric) throw new GovernedGoalError('invalid_metric')
      const validation = validateGoalDefinition({
        scope: input.scope,
        measureKind: input.measureKind,
        targetValue: input.targetValue,
        metric,
        sourcePolicy: input.sourcePolicy,
      })
      if (!validation.ok) throw new GovernedGoalError('invalid_metric')

      const now = deps.now()
      const definitionId = deps.id()
      const versionId = deps.id()
      const periodId = deps.id()
      const bounds = periodContaining(now, input.recurrenceRule, timezone)
      if (!bounds || bounds.end <= bounds.start) {
        throw new GovernedGoalError('invalid_period')
      }
      const definition: GovernedGoalDefinition = {
        id: definitionId,
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        scope: input.scope,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        status: 'active',
        statusReason: null,
        currentVersion: 1,
        createdBy: actor.userId,
        createdAt: now,
        updatedAt: now,
      }
      const version: GovernedGoalVersion = {
        id: versionId,
        definitionId,
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        version: 1,
        metric,
        measureKind: input.measureKind,
        targetValue: input.targetValue,
        sourcePolicy: input.sourcePolicy,
        propertyTimezone: timezone,
        recurrenceRule: input.recurrenceRule,
        effectiveFrom: bounds.start,
        effectiveTo: null,
        changeReason: 'created',
        createdBy: actor.userId,
        createdAt: now,
      }
      const period: GovernedGoalPeriod = {
        id: periodId,
        definitionId,
        definitionVersionId: versionId,
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        periodStart: bounds.start,
        periodEnd: bounds.end,
        propertyTimezone: timezone,
        status: bounds.start > now ? 'scheduled' : 'open',
        statusReason: null,
        evaluationWatermark: null,
        closedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      await deps.repository.createDefinition({
        definition,
        version,
        period,
        auditAction: 'goal.definition.created',
        outboxEventId: deps.id(),
      })
      return { definition, period }
    },

    list: async (
      input: Readonly<{
        propertyId: string
        visiblePortalGroupIds: readonly string[] | null
      }>,
      actor: GoalActor,
    ): Promise<readonly GovernedGoalDefinition[]> => {
      await deps.policy.authorize({
        actor,
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        action: 'goal.read',
      })
      const groups = actor.role === 'Staff' ? (input.visiblePortalGroupIds ?? []) : null
      return deps.repository.listForProperty(
        actor.organizationId,
        input.propertyId,
        groups,
      )
    },

    get: async (
      input: Readonly<{ propertyId: string; definitionId: string }>,
      actor: GoalActor,
    ) => {
      await deps.policy.authorize({
        actor,
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        action: 'goal.read',
      })
      const [definition, version, periods] = await Promise.all([
        deps.repository.getDefinition(
          actor.organizationId,
          input.propertyId,
          input.definitionId,
        ),
        deps.repository.getCurrentVersion(
          actor.organizationId,
          input.propertyId,
          input.definitionId,
        ),
        deps.repository.listOpenPeriods(
          actor.organizationId,
          input.propertyId,
          input.definitionId,
          new Date(0),
        ),
      ])
      if (!definition || !version) throw new GovernedGoalError('not_found')
      const period = periods[0] ?? null
      const evaluation = period
        ? await deps.repository.getLatestEvaluation(
            actor.organizationId,
            input.propertyId,
            period.id,
          )
        : null
      return { definition, version, period, evaluation }
    },

    revise: async (
      input: Readonly<{
        propertyId: string
        definitionId: string
        metricDefinitionVersionId: string
        measureKind: GoalMeasureKind
        targetValue: number
        sourcePolicy: string
        recurrenceRule: RecurrenceRule
        reason: string
      }>,
      actor: GoalActor,
    ): Promise<
      Readonly<{ version: GovernedGoalVersion; period: GovernedGoalPeriod }>
    > => {
      requireManager(actor)
      await deps.policy.authorize({
        actor,
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        action: 'goal.update',
      })
      const [definition, previousVersion, metric, openPeriods] = await Promise.all([
        deps.repository.getDefinition(
          actor.organizationId,
          input.propertyId,
          input.definitionId,
        ),
        deps.repository.getCurrentVersion(
          actor.organizationId,
          input.propertyId,
          input.definitionId,
        ),
        deps.metrics.getApprovedVersion(input.metricDefinitionVersionId),
        deps.repository.listOpenPeriods(
          actor.organizationId,
          input.propertyId,
          input.definitionId,
          deps.now(),
        ),
      ])
      const currentPeriod = openPeriods[0]
      if (!definition || !previousVersion || !currentPeriod) {
        throw new GovernedGoalError('not_found')
      }
      if (definition.status !== 'active') throw new GovernedGoalError('inactive')
      if (!metric) throw new GovernedGoalError('invalid_metric')
      const validation = validateGoalDefinition({
        scope: definition.scope,
        measureKind: input.measureKind,
        targetValue: input.targetValue,
        metric,
        sourcePolicy: input.sourcePolicy,
      })
      if (!validation.ok) throw new GovernedGoalError('invalid_metric')
      const now = deps.now()
      const nextStart = currentPeriod.periodEnd
      const bounds = generatePeriodSequence(
        nextStart,
        input.recurrenceRule,
        previousVersion.propertyTimezone,
        1,
      )[0]
      if (!bounds) throw new GovernedGoalError('invalid_period')
      const version: GovernedGoalVersion = {
        id: deps.id(),
        definitionId: definition.id,
        organizationId: definition.organizationId,
        propertyId: definition.propertyId,
        version: previousVersion.version + 1,
        metric,
        measureKind: input.measureKind,
        targetValue: input.targetValue,
        sourcePolicy: input.sourcePolicy,
        propertyTimezone: previousVersion.propertyTimezone,
        recurrenceRule: input.recurrenceRule,
        effectiveFrom: nextStart,
        effectiveTo: null,
        changeReason: input.reason,
        createdBy: actor.userId,
        createdAt: now,
      }
      const period: GovernedGoalPeriod = {
        id: deps.id(),
        definitionId: definition.id,
        definitionVersionId: version.id,
        organizationId: definition.organizationId,
        propertyId: definition.propertyId,
        periodStart: nextStart,
        periodEnd: bounds.end,
        propertyTimezone: previousVersion.propertyTimezone,
        status: 'scheduled',
        statusReason: 'definition_revised',
        evaluationWatermark: null,
        closedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      await deps.repository.reviseDefinition({
        previousVersion,
        version,
        period,
        auditAction: 'goal.definition.revised',
        outboxEventId: deps.id(),
      })
      return { version, period }
    },

    changeStatus: async (
      input: Readonly<{
        propertyId: string
        definitionId: string
        status: 'paused' | 'active' | 'cancelled'
        reason: string
      }>,
      actor: GoalActor,
    ): Promise<GovernedGoalDefinition> => {
      requireManager(actor)
      await deps.policy.authorize({
        actor,
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        action: input.status === 'cancelled' ? 'goal.cancel' : 'goal.update',
      })
      const definition = await deps.repository.getDefinition(
        actor.organizationId,
        input.propertyId,
        input.definitionId,
      )
      if (!definition) throw new GovernedGoalError('not_found')
      const allowed =
        (definition.status === 'active' &&
          (input.status === 'paused' || input.status === 'cancelled')) ||
        (definition.status === 'paused' &&
          (input.status === 'active' || input.status === 'cancelled'))
      if (!allowed) throw new GovernedGoalError('inactive')
      const updated = await deps.repository.changeDefinitionStatus({
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        definitionId: input.definitionId,
        expectedCurrentStatus: definition.status,
        status: input.status,
        reason: input.reason,
        actorId: actor.userId,
        at: deps.now(),
        outboxEventId: deps.id(),
      })
      if (!updated) throw new GovernedGoalError('inactive')
      return updated
    },

    evaluate: async (
      input: Readonly<{
        organizationId: string
        propertyId: string
        periodId: string
        sourceEventId: string
        reading: GovernedReading | null
        watermark: Date
        closePeriod?: boolean
        actor?: GoalActor | 'system'
      }>,
    ): Promise<GovernedGoalEvaluation> => {
      const actor = input.actor ?? 'system'
      await deps.policy.authorize({
        actor,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        action: actor === 'system' ? 'goal.update' : 'goal.read',
      })
      const period = await deps.repository.getPeriod(
        input.organizationId,
        input.propertyId,
        input.periodId,
      )
      if (!period) throw new GovernedGoalError('not_found')
      if (period.status === 'cancelled' || period.status === 'closed') {
        throw new GovernedGoalError('inactive')
      }
      const version = await deps.repository.getCurrentVersion(
        input.organizationId,
        input.propertyId,
        period.definitionId,
      )
      if (!version || version.id !== period.definitionVersionId) {
        throw new GovernedGoalError('version_mismatch')
      }
      if (
        input.reading?.definitionVersionId &&
        input.reading.definitionVersionId !== version.metric.versionId
      ) {
        throw new GovernedGoalError('version_mismatch')
      }
      if (
        input.reading?.eventAt &&
        (input.reading.eventAt < period.periodStart ||
          input.reading.eventAt >= period.periodEnd)
      ) {
        throw new GovernedGoalError('reading_out_of_period')
      }
      const result = evaluateGovernedReading({
        measureKind: version.measureKind,
        targetValue: version.targetValue,
        minimumSample: version.metric.minimumSample,
        sourcePolicy: version.sourcePolicy,
        reading: input.reading,
      })
      const now = deps.now()
      const evaluation: GovernedGoalEvaluation = {
        id: deps.id(),
        periodId: period.id,
        definitionId: period.definitionId,
        definitionVersionId: period.definitionVersionId,
        organizationId: period.organizationId,
        propertyId: period.propertyId,
        metricReadingId: input.reading?.id ?? null,
        sourceEventId: input.sourceEventId,
        idempotencyKey: `goal-evaluation:${period.id}:${input.sourceEventId}`,
        ...result,
        evaluationWatermark: input.watermark,
        supersedesEvaluationId: null,
        correctionReadingId: null,
        createdBy: actor === 'system' ? 'system' : actor.userId,
        createdAt: now,
      }
      return deps.repository.appendEvaluation({
        evaluation,
        sourceReading: input.reading,
        closePeriod: input.closePeriod === true,
        auditAction: input.closePeriod ? 'goal.period.closed' : 'goal.period.evaluated',
        outboxEventId: deps.id(),
      })
    },

    correct: async (
      input: Readonly<{
        organizationId: string
        propertyId: string
        periodId: string
        sourceEventId: string
        correctedReading: GovernedReading
        watermark: Date
      }>,
    ): Promise<GovernedGoalEvaluation> => {
      await deps.policy.authorize({
        actor: 'system',
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        action: 'goal.update',
      })
      const [period, previous] = await Promise.all([
        deps.repository.getPeriod(input.organizationId, input.propertyId, input.periodId),
        deps.repository.getLatestEvaluation(
          input.organizationId,
          input.propertyId,
          input.periodId,
        ),
      ])
      if (!period || !previous) throw new GovernedGoalError('not_found')
      const version = await deps.repository.getCurrentVersion(
        input.organizationId,
        input.propertyId,
        period.definitionId,
      )
      if (!version || version.id !== period.definitionVersionId) {
        throw new GovernedGoalError('version_mismatch')
      }
      const result = evaluateGovernedReading({
        measureKind: version.measureKind,
        targetValue: version.targetValue,
        minimumSample: version.metric.minimumSample,
        sourcePolicy: version.sourcePolicy,
        reading: input.correctedReading,
      })
      const evaluation: GovernedGoalEvaluation = {
        id: deps.id(),
        periodId: period.id,
        definitionId: period.definitionId,
        definitionVersionId: period.definitionVersionId,
        organizationId: period.organizationId,
        propertyId: period.propertyId,
        metricReadingId: input.correctedReading.id ?? null,
        sourceEventId: input.sourceEventId,
        idempotencyKey: correctionIdempotencyKey({
          periodId: period.id,
          sourceEventId: input.sourceEventId,
          correctedReadingId: input.correctedReading.id ?? input.sourceEventId,
        }),
        ...result,
        evaluationWatermark: input.watermark,
        supersedesEvaluationId: previous.id,
        correctionReadingId: input.correctedReading.id ?? null,
        createdBy: 'system',
        createdAt: deps.now(),
      }
      return deps.repository.appendEvaluation({
        evaluation,
        sourceReading: input.correctedReading,
        closePeriod: false,
        auditAction: 'goal.evaluation.corrected',
        outboxEventId: deps.id(),
      })
    },

    applyTimezoneChange: async (
      input: Readonly<{
        sourceEventId: string
        organizationId: string
        propertyId: string
        propertyVersion: number
        newTimezone: string
        effectiveAt: Date
        definitionId: string
      }>,
    ): Promise<'applied' | 'duplicate'> => {
      await deps.policy.authorize({
        actor: 'system',
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        action: 'goal.update',
      })
      const [definition, previousVersion, openPeriods] = await Promise.all([
        deps.repository.getDefinition(
          input.organizationId,
          input.propertyId,
          input.definitionId,
        ),
        deps.repository.getCurrentVersion(
          input.organizationId,
          input.propertyId,
          input.definitionId,
        ),
        deps.repository.listOpenPeriods(
          input.organizationId,
          input.propertyId,
          input.definitionId,
          input.effectiveAt,
        ),
      ])
      const currentPeriod = openPeriods[0]
      if (!definition || !previousVersion || !currentPeriod) {
        throw new GovernedGoalError('not_found')
      }
      if (definition.status !== 'active') throw new GovernedGoalError('inactive')
      const now = deps.now()
      const versionId = deps.id()
      const periodId = deps.id()
      const nextStart = currentPeriod.periodEnd
      const nextBounds = generatePeriodSequence(
        nextStart,
        previousVersion.recurrenceRule,
        input.newTimezone,
        1,
      )[0]
      if (!nextBounds) throw new GovernedGoalError('invalid_period')
      const version: GovernedGoalVersion = {
        ...previousVersion,
        id: versionId,
        version: previousVersion.version + 1,
        propertyTimezone: input.newTimezone,
        effectiveFrom: nextStart,
        effectiveTo: null,
        changeReason: `property_timezone_changed:${input.sourceEventId}`,
        createdBy: 'system',
        createdAt: now,
      }
      const period: GovernedGoalPeriod = {
        id: periodId,
        definitionId: definition.id,
        definitionVersionId: versionId,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        periodStart: nextStart,
        periodEnd: nextBounds.end,
        propertyTimezone: input.newTimezone,
        status: 'scheduled',
        statusReason: 'property_timezone_changed',
        evaluationWatermark: null,
        closedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      return deps.repository.appendTimezoneVersion({
        sourceEventId: input.sourceEventId,
        propertyVersion: input.propertyVersion,
        previousVersion,
        version,
        period,
        auditAction: 'goal.timezone_version.scheduled',
        outboxEventId: deps.id(),
      })
    },
  }
}

export type GovernedGoalService = ReturnType<typeof createGovernedGoalService>
