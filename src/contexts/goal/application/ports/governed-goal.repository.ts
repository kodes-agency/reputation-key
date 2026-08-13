import type {
  GoalDefinitionStatus,
  GoalEvaluationState,
  GoalMeasureKind,
  GoalPeriodStatus,
  GoalScope,
  GovernedMetricVersion,
  GovernedReading,
} from '../../domain/governed-goal'
import type { RecurrenceRule } from '../../domain/goal-recurrence'

export type GovernedGoalDefinition = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  scope: GoalScope
  name: string
  description: string | null
  status: GoalDefinitionStatus
  statusReason: string | null
  currentVersion: number
  createdBy: string
  createdAt: Date
  updatedAt: Date
}>

export type GovernedGoalVersion = Readonly<{
  id: string
  definitionId: string
  organizationId: string
  propertyId: string
  version: number
  metric: GovernedMetricVersion
  measureKind: GoalMeasureKind
  targetValue: number
  sourcePolicy: string
  propertyTimezone: string
  recurrenceRule: RecurrenceRule
  effectiveFrom: Date
  effectiveTo: Date | null
  changeReason: string
  createdBy: string
  createdAt: Date
}>

export type GovernedGoalPeriod = Readonly<{
  id: string
  definitionId: string
  definitionVersionId: string
  organizationId: string
  propertyId: string
  periodStart: Date
  periodEnd: Date
  propertyTimezone: string
  status: GoalPeriodStatus
  statusReason: string | null
  evaluationWatermark: Date | null
  closedAt: Date | null
  createdAt: Date
  updatedAt: Date
}>

export type GovernedGoalEvaluation = Readonly<{
  id: string
  periodId: string
  definitionId: string
  definitionVersionId: string
  organizationId: string
  propertyId: string
  metricReadingId: string | null
  sourceEventId: string | null
  idempotencyKey: string
  state: GoalEvaluationState
  reason: string | null
  value: number | null
  numerator: number | null
  denominator: number | null
  sampleCount: number | null
  achieved: boolean
  evaluationWatermark: Date
  supersedesEvaluationId: string | null
  correctionReadingId: string | null
  createdBy: string
  createdAt: Date
}>

export type GoalScopeEnvelope = Readonly<{
  organizationId: string
  propertyId: string
  definitionId: string
}>

export type GovernedGoalRepository = Readonly<{
  getDefinitionScope(
    organizationId: string,
    definitionId: string,
  ): Promise<GoalScopeEnvelope | null>
  getDefinition(
    organizationId: string,
    propertyId: string,
    definitionId: string,
  ): Promise<GovernedGoalDefinition | null>
  getCurrentVersion(
    organizationId: string,
    propertyId: string,
    definitionId: string,
  ): Promise<GovernedGoalVersion | null>
  getPeriod(
    organizationId: string,
    propertyId: string,
    periodId: string,
  ): Promise<GovernedGoalPeriod | null>
  getLatestEvaluation(
    organizationId: string,
    propertyId: string,
    periodId: string,
  ): Promise<GovernedGoalEvaluation | null>
  listForProperty(
    organizationId: string,
    propertyId: string,
    visiblePortalGroupIds: readonly string[] | null,
  ): Promise<readonly GovernedGoalDefinition[]>
  createDefinition(
    input: Readonly<{
      definition: GovernedGoalDefinition
      version: GovernedGoalVersion
      period: GovernedGoalPeriod
      auditAction: string
      outboxEventId: string
    }>,
  ): Promise<void>
  reviseDefinition(
    input: Readonly<{
      previousVersion: GovernedGoalVersion
      version: GovernedGoalVersion
      period: GovernedGoalPeriod
      auditAction: string
      outboxEventId: string
    }>,
  ): Promise<void>
  changeDefinitionStatus(
    input: Readonly<{
      organizationId: string
      propertyId: string
      definitionId: string
      expectedCurrentStatus: GoalDefinitionStatus
      status: GoalDefinitionStatus
      reason: string
      actorId: string
      at: Date
      outboxEventId: string
    }>,
  ): Promise<GovernedGoalDefinition | null>
  appendEvaluation(
    input: Readonly<{
      evaluation: GovernedGoalEvaluation
      sourceReading: GovernedReading | null
      closePeriod: boolean
      auditAction: string
      outboxEventId: string
    }>,
  ): Promise<GovernedGoalEvaluation>
  appendTimezoneVersion(
    input: Readonly<{
      sourceEventId: string
      propertyVersion: number
      previousVersion: GovernedGoalVersion
      version: GovernedGoalVersion
      period: GovernedGoalPeriod
      auditAction: string
      outboxEventId: string
    }>,
  ): Promise<'applied' | 'duplicate'>
  enumerateActiveScopes(): Promise<readonly GoalScopeEnvelope[]>
  enumerateActiveScopesForProperty(
    organizationId: string,
    propertyId: string,
  ): Promise<readonly GoalScopeEnvelope[]>
  enumerateDueScopes(now: Date): Promise<readonly GoalScopeEnvelope[]>
  listOpenPeriods(
    organizationId: string,
    propertyId: string,
    definitionId: string,
    at: Date,
  ): Promise<readonly GovernedGoalPeriod[]>
}>
