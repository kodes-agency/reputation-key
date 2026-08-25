import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import { GOAL_RECONCILIATION_DELAY_MS } from '#/shared/domain/metric-governance'
import type { MetricKey } from '#/shared/domain/metric-keys'
import {
  METRIC_VERSION_IDS,
  type GovernedMetricVersion,
} from '../../domain/metric-registry'
import type { GoalMetricSourceStatusPort } from '../ports/goal-metric-source-status.port'
import type {
  GoalMetricAggregate,
  GoalMetricAggregateQuery,
  GoalMetricSubject,
  MetricRepository,
} from '../ports/metric.repository'
import type { MetricRegistryRepository } from '../ports/metric-registry.repository.port'

type GoalMetricSpec = Readonly<{
  metricKey: MetricKey
  calculation: 'sum' | 'weighted_average'
  sourceActive: boolean
  eventTypes: readonly string[]
}>

const GOAL_METRIC_SPECS: Readonly<Record<string, GoalMetricSpec>> = {
  [METRIC_VERSION_IDS.qualifiedScanGoal]: {
    metricKey: 'portal.qualified_scan',
    calculation: 'sum',
    sourceActive: false,
    eventTypes: [],
  },
  [METRIC_VERSION_IDS.portalRatingCountGoal]: {
    metricKey: 'portal.rating_count',
    calculation: 'sum',
    sourceActive: true,
    eventTypes: ['guest.rating.submitted', 'guest.rating.retracted'],
  },
  [METRIC_VERSION_IDS.portalRatingAverageGoal]: {
    metricKey: 'portal.rating_average',
    calculation: 'weighted_average',
    sourceActive: true,
    eventTypes: ['guest.rating.submitted', 'guest.rating.retracted'],
  },
}

export type GovernedGoalMetricQuery = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  definitionVersionId: string
  subject: GoalMetricSubject
  periodStart: Date
  periodEnd: Date
}>

export type GovernedGoalMetricResult = Readonly<{
  definitionVersionId: string
  metricKey: MetricKey | null
  state: 'eligible' | 'updating' | 'insufficient_data' | 'unavailable' | 'quarantined'
  exactValue: number | null
  sampleCount: number
  minimumSample: number | null
  sourceCompleteThrough: Date | null
  reason: string | null
}>

export type QueryGoalMetricDeps = Readonly<{
  metrics: MetricRepository
  registry: MetricRegistryRepository
  sourceStatus: GoalMetricSourceStatusPort
  validateSubject(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    subject: GoalMetricSubject,
  ): Promise<boolean>
  clock: () => Date
}>

export type QueryGoalMetric = (
  query: GovernedGoalMetricQuery,
) => Promise<GovernedGoalMetricResult>

function unavailable(
  query: GovernedGoalMetricQuery,
  reason: string,
  metricKey: MetricKey | null = null,
  minimumSample: number | null = null,
): GovernedGoalMetricResult {
  return {
    definitionVersionId: query.definitionVersionId,
    metricKey,
    state: 'unavailable',
    exactValue: null,
    sampleCount: 0,
    minimumSample,
    sourceCompleteThrough: null,
    reason,
  }
}

function governedVersionIsUsable(
  governed: GovernedMetricVersion,
  spec: GoalMetricSpec,
  query: GovernedGoalMetricQuery,
): boolean {
  const { definition, version } = governed
  return (
    definition.lifecycleStatus === 'approved' &&
    definition.key === spec.metricKey &&
    version.permittedConsumers.includes('goal') &&
    version.employmentDecisionEligible === false &&
    version.allowedScopes.includes(query.subject.kind) &&
    version.effectiveFrom <= query.periodStart &&
    (version.effectiveTo === null || version.effectiveTo >= query.periodEnd)
  )
}

function hasInvalidAggregate(aggregate: GoalMetricAggregate): boolean {
  return (
    !Number.isFinite(aggregate.sum) ||
    !Number.isFinite(aggregate.weightedSum) ||
    !Number.isInteger(aggregate.sampleCount) ||
    aggregate.sampleCount < 0 ||
    !Number.isInteger(aggregate.readingCount) ||
    aggregate.readingCount < 0 ||
    aggregate.invalidQualityCount > 0 ||
    aggregate.invalidSampleCount > 0 ||
    aggregate.invalidSourceCount > 0 ||
    aggregate.invalidDefinitionCount > 0 ||
    aggregate.approximateCount > 0
  )
}

function exactValue(
  spec: GoalMetricSpec,
  aggregate: GoalMetricAggregate,
  precision: number,
): number | null {
  if (spec.calculation === 'sum') return aggregate.sum
  if (aggregate.sampleCount === 0) return null
  const factor = 10 ** precision
  return Math.round((aggregate.weightedSum / aggregate.sampleCount) * factor) / factor
}

function validValue(spec: GoalMetricSpec, value: number | null): boolean {
  if (value === null || !Number.isFinite(value)) {
    return spec.calculation === 'weighted_average' && value === null
  }
  if (spec.calculation === 'sum') return Number.isInteger(value) && value >= 0
  return value >= 1 && value <= 5
}

export const queryGoalMetric =
  (deps: QueryGoalMetricDeps): QueryGoalMetric =>
  async (query) => {
    if (
      Number.isNaN(query.periodStart.getTime()) ||
      Number.isNaN(query.periodEnd.getTime()) ||
      query.periodEnd <= query.periodStart
    ) {
      return unavailable(query, 'invalid_period')
    }

    const spec = GOAL_METRIC_SPECS[query.definitionVersionId]
    if (!spec) return unavailable(query, 'metric_not_beta_goal_eligible')

    const governed = await deps.registry.findVersionById(query.definitionVersionId)
    if (!governed || !governedVersionIsUsable(governed, spec, query)) {
      return unavailable(query, 'metric_version_unavailable', spec.metricKey)
    }
    if (!spec.sourceActive) {
      return unavailable(
        query,
        'metric_source_not_active',
        spec.metricKey,
        governed.version.minimumSample,
      )
    }
    if (
      !(await deps.validateSubject(query.organizationId, query.propertyId, query.subject))
    ) {
      return unavailable(
        query,
        'subject_unavailable',
        spec.metricKey,
        governed.version.minimumSample,
      )
    }

    const aggregateQuery: GoalMetricAggregateQuery = {
      ...query,
      expectedMetricKey: spec.metricKey,
      allowedSourcePolicies: governed.version.sourcePolicyAllowlist,
    }
    const [aggregate, source] = await Promise.all([
      deps.metrics.queryGoalAggregate(aggregateQuery),
      deps.sourceStatus.inspect(aggregateQuery, spec.eventTypes),
    ])
    const value = exactValue(spec, aggregate, governed.version.precision)
    const common = {
      definitionVersionId: query.definitionVersionId,
      metricKey: spec.metricKey,
      exactValue: validValue(spec, value) ? value : null,
      sampleCount: aggregate.sampleCount,
      minimumSample: governed.version.minimumSample,
      sourceCompleteThrough: null,
    } as const

    if (source.state === 'quarantined' || hasInvalidAggregate(aggregate)) {
      return {
        ...common,
        state: 'quarantined',
        reason: source.reason ?? 'invalid_governed_reading',
      }
    }
    if (!validValue(spec, value)) {
      return { ...common, state: 'quarantined', reason: 'invalid_metric_value' }
    }
    if (source.state === 'unavailable') {
      return { ...common, state: 'unavailable', reason: source.reason }
    }

    const reconciliationReadyAt = query.periodEnd.getTime() + GOAL_RECONCILIATION_DELAY_MS
    if (
      source.state === 'pending' ||
      aggregate.updatingCount > 0 ||
      deps.clock().getTime() < reconciliationReadyAt
    ) {
      return { ...common, state: 'updating', reason: 'source_reconciling' }
    }
    if (aggregate.sampleCount < governed.version.minimumSample) {
      return {
        ...common,
        state: 'insufficient_data',
        exactValue: null,
        sourceCompleteThrough: query.periodEnd,
        reason: 'minimum_sample_not_met',
      }
    }
    return {
      ...common,
      state: 'eligible',
      sourceCompleteThrough: query.periodEnd,
      reason: null,
    }
  }
