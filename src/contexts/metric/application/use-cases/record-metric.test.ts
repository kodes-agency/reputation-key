import { describe, expect, it } from 'vitest'
import {
  recordMetric,
  type RecordMetricDeps,
  type RecordMetricInput,
} from './record-metric'
import type { MetricReading } from '../../domain/metric-reading'
import type { GovernedMetricVersion } from '../../domain/metric-registry'
import type { QuarantineMetricCommand } from '../ports/metric-command-store.port'
import type { DomainEvent } from '#/shared/events/events'
import { createSequentialMetricCommandStore } from '#/shared/testing/sequential-metric-command-store'
import {
  metricReadingId,
  organizationId,
  portalGroupId,
  propertyId,
} from '#/shared/domain/ids'

const NOW = new Date('2026-08-08T12:00:00Z')

const governed: GovernedMetricVersion = {
  definition: {
    id: 'definition-1',
    key: 'portal.content_review.completed',
    name: 'Content reviews',
    description: 'Explicit content reviews',
    valueKind: 'counter',
    workerDataFlag: false,
    privacyClass: 'operational',
    retentionClass: 'standard',
    lifecycleStatus: 'approved',
    approvalOwner: 'product-governance',
  },
  version: {
    id: '11111111-1111-4111-8111-111111111101',
    definitionId: 'definition-1',
    version: 1,
    effectiveFrom: new Date('2026-08-08T00:00:00Z'),
    effectiveTo: null,
    numeratorDescription: 'Completed reviews',
    denominatorDescription: null,
    unit: 'review',
    precision: 0,
    aggregationRule: 'sum',
    lateArrivalRule: 'accept_with_source_event_time',
    allowedScopes: ['property', 'portal_group'],
    attributionRule: 'effective group at event time',
    minimumSample: 1,
    insufficientDataBehavior: 'unavailable',
    sourcePolicyAllowlist: ['first_party_workflow'],
    permittedConsumers: ['dashboard', 'goal', 'badge', 'leaderboard', 'notification'],
    employmentDecisionEligible: false,
    correctionBehavior: 'append_delta',
    fairnessReviewStatus: 'approved_for_declared_consumers',
  },
}

const input = (overrides: Partial<RecordMetricInput> = {}): RecordMetricInput => ({
  organizationId: organizationId('org-1'),
  propertyId: propertyId('d4000000-0000-4000-8000-000000000051'),
  portalId: null,
  portalGroupId: portalGroupId('d4000000-0000-4000-8000-000000000061'),
  definitionVersionId: governed.version.id,
  sourceEventId: 'event-1',
  sourcePolicy: 'first_party_workflow',
  scope: 'portal_group',
  value: 1,
  sampleCount: 1,
  occurredAt: NOW,
  attributionQuality: 'exact',
  ...overrides,
})

const createDeps = (version: GovernedMetricVersion | null = governed) => {
  const readings: MetricReading[] = []
  const quarantined: QuarantineMetricCommand[] = []
  const events: DomainEvent[] = []
  const bus = {
    on: () => {},
    emit: async (event: DomainEvent) => {
      events.push(event)
    },
    clear: () => {},
  }
  const deps: RecordMetricDeps = {
    commandStore: createSequentialMetricCommandStore({
      insertReading: async (reading) => {
        readings.push(reading)
        return reading
      },
      quarantine: async (command) => {
        quarantined.push(command)
      },
      events: bus,
    }),
    registry: { findVersionById: async () => version },
    clock: () => NOW,
    idGen: () => metricReadingId('d4000000-0000-4000-8000-000000000071'),
    resolvePropertyLocalDate: async () => '2026-08-08',
  }
  return { deps, readings, quarantined, events }
}

describe('recordMetric', () => {
  it('records a versioned reading and emits only its registry-approved consumers', async () => {
    const fakes = createDeps()
    const result = await recordMetric(fakes.deps)(input())

    expect(result.status).toBe('recorded')
    expect(fakes.readings).toHaveLength(1)
    expect(fakes.readings[0]).toMatchObject({
      definitionVersionId: governed.version.id,
      metricKey: 'portal.content_review.completed',
      sourceEventId: 'event-1',
      sourcePolicy: 'first_party_workflow',
      portalGroupId: 'd4000000-0000-4000-8000-000000000061',
      propertyLocalDate: '2026-08-08',
    })
    expect(fakes.events).toHaveLength(1)
    expect(fakes.events[0]).toMatchObject({
      _tag: 'metric.recorded',
      permittedConsumers: governed.version.permittedConsumers,
    })
  })

  it('quarantines an unknown immutable version without recording or emitting', async () => {
    const fakes = createDeps(null)
    const result = await recordMetric(fakes.deps)(input())

    expect(result).toEqual({
      status: 'quarantined',
      reason: 'unknown_definition_version',
      sourceEventId: 'event-1',
    })
    expect(fakes.quarantined[0]).toMatchObject({
      definitionVersionId: null,
      reason: 'unknown_definition_version',
    })
    expect(fakes.quarantined[0]?.payloadHash).toMatch(/^[a-f0-9]{64}$/)
    expect(fakes.readings).toEqual([])
    expect(fakes.events).toEqual([])
  })

  it.each([
    ['source_policy_not_allowed', { sourcePolicy: 'google_property_derivative' }],
    ['scope_not_allowed', { scope: 'portal' }],
    ['unresolved_attribution', { attributionQuality: 'unresolved' }],
  ] as const)('quarantines %s readings', async (reason, overrides) => {
    const fakes = createDeps()
    const result = await recordMetric(fakes.deps)(input(overrides))

    expect(result).toMatchObject({ status: 'quarantined', reason })
    expect(fakes.readings).toEqual([])
  })

  it('reports insufficient ratio data without persisting a misleading zero', async () => {
    const ratio: GovernedMetricVersion = {
      definition: {
        ...governed.definition,
        key: 'portal.approved_destination_ratio',
        valueKind: 'ratio',
      },
      version: {
        ...governed.version,
        id: '11111111-1111-4111-8111-111111111103',
        minimumSample: 5,
      },
    }
    const fakes = createDeps(ratio)
    const result = await recordMetric(fakes.deps)(
      input({
        definitionVersionId: ratio.version.id,
        value: 0.5,
        numerator: 1,
        denominator: 2,
        sampleCount: 2,
      }),
    )

    expect(result).toEqual({
      status: 'insufficient_data',
      definitionVersionId: ratio.version.id,
      minimumSample: 5,
      actualSample: 2,
    })
    expect(fakes.readings).toEqual([])
    expect(fakes.quarantined).toEqual([])
  })
})
