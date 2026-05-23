import { describe, it, expect } from 'vitest'
import { recordMetric, type RecordMetricDeps } from './record-metric'
import type { MetricReading } from '../../domain/types'
import type { DomainEvent } from '#/shared/events/events'
import {
  organizationId,
  propertyId,
  portalId,
  metricReadingId,
  staffId,
} from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-01-01')

type InsertInput = Omit<MetricReading, 'id'>

const createFakeDeps = (): RecordMetricDeps & {
  readings: InsertInput[]
  emittedEvents: DomainEvent[]
} => {
  const readings: InsertInput[] = []
  const emittedEvents: DomainEvent[] = []
  return {
    readings,
    emittedEvents,
    metricRepo: {
      insertReading: async (input: InsertInput) => {
        const reading: MetricReading = {
          id: metricReadingId(`mr-${readings.length + 1}`),
          ...input,
        }
        readings.push(reading)
        return reading
      },
      findByOrganizationId: async () => [],
      queryAggregate: async () => ({ sum: 0, count: 0, max: 0 }),
    },
    events: {
      on: () => {},
      emit: async (event: DomainEvent) => {
        emittedEvents.push(event)
      },
      clear: () => {},
    },
    clock: () => FIXED_TIME,
  }
}

describe('recordMetric', () => {
  it('accepts nullable staffId and passes it through', async () => {
    const deps = createFakeDeps()

    const withStaff = await recordMetric(deps)({
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: portalId('portal-1'),
      metricKey: 'portal.scan',
      value: 1,
      staffId: staffId('staff-1'),
    })
    expect(withStaff.staffId).toBe('staff-1')

    const withoutStaff = await recordMetric(deps)({
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: portalId('portal-1'),
      metricKey: 'portal.scan',
      value: 1,
      staffId: null,
    })
    expect(withoutStaff.staffId).toBeNull()
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
      staffId: null,
    })

    expect(deps.emittedEvents).toHaveLength(1)
    expect(deps.emittedEvents[0]!._tag).toBe('metric.recorded')
  })
})
