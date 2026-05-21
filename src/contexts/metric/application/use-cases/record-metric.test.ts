import { describe, it, expect, beforeEach } from 'vitest'
import { recordMetric, type RecordMetricDeps } from './record-metric'
import type { MetricKey, MetricReading } from '../../domain/types'

const FIXED_TIME = new Date('2026-05-20T12:00:00Z')

type InsertInput = Omit<MetricReading, 'id'>

const createFakeDeps = (): RecordMetricDeps & { readings: InsertInput[] } => {
  const readings: InsertInput[] = []
  return {
    readings,
    metricRepo: {
      insertReading: async (input) => {
        const reading: MetricReading = {
          id: `metric-${readings.length + 1}`,
          ...input,
        }
        readings.push(input)
        return reading
      },
      findByOrganizationId: async () => [],
    },
    clock: () => FIXED_TIME,
  }
}

describe('recordMetric', () => {
  let deps: ReturnType<typeof createFakeDeps>

  beforeEach(() => {
    deps = createFakeDeps()
  })

  it('inserts a reading for a known metric key', async () => {
    const record = recordMetric(deps)

    await record({
      organizationId: 'org-1',
      propertyId: 'prop-1',
      portalId: 'portal-1',
      metricKey: 'portal.scan',
      value: 1,
    })

    expect(deps.readings).toHaveLength(1)
    expect(deps.readings[0]).toEqual({
      organizationId: 'org-1',
      propertyId: 'prop-1',
      portalId: 'portal-1',
      metricKey: 'portal.scan',
      value: 1,
      recordedAt: FIXED_TIME,
    })
  })

  it('inserts a rating reading with star value', async () => {
    const record = recordMetric(deps)

    await record({
      organizationId: 'org-1',
      propertyId: 'prop-1',
      portalId: 'portal-1',
      metricKey: 'portal.rating',
      value: 4,
    })

    expect(deps.readings[0]!.value).toBe(4)
  })

  it('rejects an unknown metric key', async () => {
    const record = recordMetric(deps)

    await expect(
      record({
        organizationId: 'org-1',
        propertyId: 'prop-1',
        portalId: null,
        metricKey: 'unknown.metric' as MetricKey,
        value: 1,
      }),
    ).rejects.toThrow('Unknown metric key: unknown.metric')

    expect(deps.readings).toHaveLength(0)
  })

  it('inserts a property-level reading with null portalId', async () => {
    const record = recordMetric(deps)

    await record({
      organizationId: 'org-1',
      propertyId: 'prop-1',
      portalId: null,
      metricKey: 'property.review',
      value: 3,
    })

    expect(deps.readings[0]!.portalId).toBeNull()
    expect(deps.readings[0]!.metricKey).toBe('property.review')
  })
})
