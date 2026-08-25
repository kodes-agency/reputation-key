import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId } from '#/shared/domain/ids'
import {
  METRIC_VERSION_IDS,
  type GovernedMetricVersion,
} from '../../domain/metric-registry'
import type { GoalMetricSourceStatus } from '../ports/goal-metric-source-status.port'
import type {
  GoalMetricAggregate,
  GoalMetricSubject,
  MetricRepository,
} from '../ports/metric.repository'
import { queryGoalMetric } from './query-goal-metric'

const ORG = organizationId('org-1')
const PROPERTY = propertyId('10000000-0000-4000-8000-000000000001')
const START = new Date('2026-06-01T00:00:00.000Z')
const END = new Date('2026-07-01T00:00:00.000Z')
const AFTER_RECONCILIATION = new Date('2026-07-02T00:00:00.001Z')

const subject: GoalMetricSubject = { kind: 'property', propertyId: PROPERTY }

const aggregate = (
  overrides: Partial<GoalMetricAggregate> = {},
): GoalMetricAggregate => ({
  sum: 0,
  weightedSum: 0,
  sampleCount: 0,
  readingCount: 0,
  approximateCount: 0,
  updatingCount: 0,
  invalidQualityCount: 0,
  invalidSampleCount: 0,
  invalidSourceCount: 0,
  invalidDefinitionCount: 0,
  ...overrides,
})

const source = (
  overrides: Partial<GoalMetricSourceStatus> = {},
): GoalMetricSourceStatus => ({
  state: 'complete',
  relevantFactCount: 0,
  pendingFactCount: 0,
  reason: null,
  ...overrides,
})

function governed(
  id: string,
  metricKey: GovernedMetricVersion['definition']['key'],
  minimumSample: number,
  precision: number,
): GovernedMetricVersion {
  return {
    definition: {
      id: `definition-${id}`,
      key: metricKey,
      name: metricKey,
      description: metricKey,
      valueKind: metricKey === 'portal.rating_average' ? 'average' : 'counter',
      workerDataFlag: false,
      privacyClass: 'managerial_context',
      retentionClass: 'guest_gateway_24_month',
      lifecycleStatus: 'approved',
      approvalOwner: 'architecture-review',
    },
    version: {
      id,
      definitionId: `definition-${id}`,
      version: 1,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: null,
      numeratorDescription: 'eligible facts',
      denominatorDescription: null,
      unit: metricKey === 'portal.rating_average' ? 'stars' : 'count',
      precision,
      aggregationRule: metricKey === 'portal.rating_average' ? 'weighted_average' : 'sum',
      lateArrivalRule: 'close_after_24h',
      allowedScopes: ['property', 'portal_group', 'portal'],
      attributionRule: 'event_time_portal',
      minimumSample,
      insufficientDataBehavior: 'unavailable',
      sourcePolicyAllowlist: ['first_party_guest_gateway_metric'],
      permittedConsumers: ['dashboard', 'goal'],
      employmentDecisionEligible: false,
      correctionBehavior: 'append_delta',
      fairnessReviewStatus: 'approved_manager_context',
    },
  }
}

function harness(input: {
  versionId?: string
  metricKey?: GovernedMetricVersion['definition']['key']
  minimumSample?: number
  precision?: number
  aggregate?: GoalMetricAggregate
  source?: GoalMetricSourceStatus
  now?: Date
  subjectValid?: boolean
}) {
  const versionId = input.versionId ?? METRIC_VERSION_IDS.portalRatingCountGoal
  const queryGoalAggregate = vi.fn(async () => input.aggregate ?? aggregate())
  const metrics: MetricRepository = {
    queryAggregate: async () => ({
      sum: 0,
      count: 0,
      max: 0,
      available: false,
      sampleCount: 0,
      minimumSample: 1,
    }),
    queryGoalAggregate,
  }
  const inspect = vi.fn(async () => input.source ?? source())
  const useCase = queryGoalMetric({
    metrics,
    registry: {
      findVersionById: async (id) =>
        id === versionId
          ? governed(
              versionId,
              input.metricKey ?? 'portal.rating_count',
              input.minimumSample ?? 0,
              input.precision ?? 0,
            )
          : null,
    },
    sourceStatus: { inspect },
    validateSubject: async () => input.subjectValid ?? true,
    clock: () => input.now ?? AFTER_RECONCILIATION,
  })
  return { useCase, queryGoalAggregate, inspect }
}

const query = (definitionVersionId: string) => ({
  organizationId: ORG,
  propertyId: PROPERTY,
  definitionVersionId,
  subject,
  periodStart: START,
  periodEnd: END,
})

describe('queryGoalMetric', () => {
  it('returns a verified zero count only after source completeness and reconciliation', async () => {
    const { useCase } = harness({})
    await expect(
      useCase(query(METRIC_VERSION_IDS.portalRatingCountGoal)),
    ).resolves.toMatchObject({
      state: 'eligible',
      exactValue: 0,
      sampleCount: 0,
      sourceCompleteThrough: END,
      reason: null,
    })
  })

  it('keeps a complete current period updating until the late-arrival window closes', async () => {
    const { useCase } = harness({ now: new Date('2026-07-01T12:00:00.000Z') })
    await expect(
      useCase(query(METRIC_VERSION_IDS.portalRatingCountGoal)),
    ).resolves.toMatchObject({
      state: 'updating',
      exactValue: 0,
      sourceCompleteThrough: null,
    })
  })

  it('keeps a period updating while any relevant durable receipt is pending', async () => {
    const { useCase } = harness({
      aggregate: aggregate({ sum: 12, sampleCount: 12, readingCount: 12 }),
      source: source({
        state: 'pending',
        relevantFactCount: 13,
        pendingFactCount: 1,
        reason: 'consumer_receipt_pending',
      }),
    })
    await expect(
      useCase(query(METRIC_VERSION_IDS.portalRatingCountGoal)),
    ).resolves.toMatchObject({ state: 'updating', exactValue: 12 })
  })

  it('computes an average from weighted facts and enforces its minimum sample', async () => {
    const eligible = harness({
      versionId: METRIC_VERSION_IDS.portalRatingAverageGoal,
      metricKey: 'portal.rating_average',
      minimumSample: 10,
      precision: 1,
      aggregate: aggregate({
        sum: 43,
        weightedSum: 43,
        sampleCount: 10,
        readingCount: 10,
      }),
    })
    await expect(
      eligible.useCase(query(METRIC_VERSION_IDS.portalRatingAverageGoal)),
    ).resolves.toMatchObject({ state: 'eligible', exactValue: 4.3, sampleCount: 10 })

    const insufficient = harness({
      versionId: METRIC_VERSION_IDS.portalRatingAverageGoal,
      metricKey: 'portal.rating_average',
      minimumSample: 10,
      precision: 1,
      aggregate: aggregate({
        sum: 40,
        weightedSum: 40,
        sampleCount: 9,
        readingCount: 9,
      }),
    })
    await expect(
      insufficient.useCase(query(METRIC_VERSION_IDS.portalRatingAverageGoal)),
    ).resolves.toMatchObject({
      state: 'insufficient_data',
      exactValue: null,
      sampleCount: 9,
      sourceCompleteThrough: END,
    })
  })

  it('fails closed for a quarantined source or invalid governed row', async () => {
    const sourceQuarantined = harness({
      source: source({ state: 'quarantined', reason: 'source_fact_quarantined' }),
    })
    await expect(
      sourceQuarantined.useCase(query(METRIC_VERSION_IDS.portalRatingCountGoal)),
    ).resolves.toMatchObject({
      state: 'quarantined',
      reason: 'source_fact_quarantined',
    })

    const invalidRow = harness({
      aggregate: aggregate({ invalidSourceCount: 1 }),
    })
    await expect(
      invalidRow.useCase(query(METRIC_VERSION_IDS.portalRatingCountGoal)),
    ).resolves.toMatchObject({ state: 'quarantined', reason: 'invalid_governed_reading' })
  })

  it('does not fabricate qualified scans before signed source activation', async () => {
    const { useCase, queryGoalAggregate, inspect } = harness({
      versionId: METRIC_VERSION_IDS.qualifiedScanGoal,
      metricKey: 'portal.qualified_scan',
    })
    await expect(
      useCase(query(METRIC_VERSION_IDS.qualifiedScanGoal)),
    ).resolves.toMatchObject({
      metricKey: 'portal.qualified_scan',
      state: 'unavailable',
      exactValue: null,
      reason: 'metric_source_not_active',
    })
    expect(queryGoalAggregate).not.toHaveBeenCalled()
    expect(inspect).not.toHaveBeenCalled()
  })

  it('rejects unknown versions, invalid periods, and cross-property subjects', async () => {
    const unknown = harness({})
    await expect(unknown.useCase(query('unknown-version'))).resolves.toMatchObject({
      state: 'unavailable',
      reason: 'metric_not_beta_goal_eligible',
    })

    await expect(
      unknown.useCase({
        ...query(METRIC_VERSION_IDS.portalRatingCountGoal),
        periodStart: END,
        periodEnd: START,
      }),
    ).resolves.toMatchObject({ state: 'unavailable', reason: 'invalid_period' })

    const invalidSubject = harness({ subjectValid: false })
    await expect(
      invalidSubject.useCase(query(METRIC_VERSION_IDS.portalRatingCountGoal)),
    ).resolves.toMatchObject({ state: 'unavailable', reason: 'subject_unavailable' })
  })
})
