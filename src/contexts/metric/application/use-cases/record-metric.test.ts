import { describe, it, expect } from 'vitest'
import { recordMetric, type RecordMetricDeps } from './record-metric'
import type { MetricReading } from '../../domain/types'
import type { DomainEvent } from '#/shared/events/events'
import type { MetricRepository } from '../ports/metric.repository'
import { createSequentialMetricCommandStore } from '#/shared/testing/sequential-metric-command-store'
import {
  organizationId,
  propertyId,
  portalId,
  metricReadingId,
  portalGroupId,
} from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-01-01')

type InsertInput = MetricReading

const createFakeDeps = (): RecordMetricDeps & {
  readings: InsertInput[]
  emittedEvents: DomainEvent[]
} => {
  const readings: InsertInput[] = []
  const emittedEvents: DomainEvent[] = []
  const metricRepo: MetricRepository = {
    insertReading: async (input: MetricReading) => {
      readings.push(input)
      return input
    },
    queryAggregate: async () => ({ sum: 0, count: 0, max: 0 }),
  }
  const events = {
    on: () => {},
    emit: async (event: DomainEvent) => {
      emittedEvents.push(event)
    },
    clear: () => {},
  }
  return {
    readings,
    emittedEvents,
    commandStore: createSequentialMetricCommandStore({ repo: metricRepo, events }),
    clock: () => FIXED_TIME,
    idGen: () => metricReadingId('mr-gen'),
  }
}

describe('recordMetric', () => {
  it('accepts nullable groupId and passes it through', async () => {
    const deps = createFakeDeps()

    const withGroup = await recordMetric(deps)({
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: portalId('portal-1'),
      metricKey: 'portal.scan',
      value: 1,
      groupId: portalGroupId('group-1'),
    })
    expect(withGroup.groupId).toBe('group-1')

    const withoutGroup = await recordMetric(deps)({
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: portalId('portal-1'),
      metricKey: 'portal.scan',
      value: 1,
      groupId: null,
    })
    expect(withoutGroup.groupId).toBeNull()
  })

  it('emits a MetricRecorded event after inserting a reading', async () => {
    const deps = createFakeDeps()
    const record = recordMetric(deps)

    await record({
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: portalId('portal-1'),
      metricKey: 'portal.scan',
      value: 1,
      groupId: null,
    })

    expect(deps.readings).toHaveLength(1)
    expect(deps.emittedEvents).toHaveLength(1)
    expect(deps.emittedEvents[0]!._tag).toBe('metric.recorded')
  })
})
