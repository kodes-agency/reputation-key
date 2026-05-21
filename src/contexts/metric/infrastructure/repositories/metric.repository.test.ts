import { describe, it, expect, beforeEach } from 'vitest'
import type { MetricReading } from '../../domain/types'

// In-memory fake for MetricRepository port.
// Tests the port contract, not the Drizzle implementation.
// The Drizzle implementation is covered by integration tests.

type InsertInput = Omit<MetricReading, 'id'>

const createFakeMetricRepository = () => {
  const readings: MetricReading[] = []
  let nextId = 1

  return {
    readings,
    repo: {
      insertReading: async (input: InsertInput) => {
        const reading: MetricReading = {
          ...input,
          id: `metric-${nextId++}`,
        }
        readings.push(reading)
        return reading
      },

      findByOrganizationId: async (orgId: string, metricKey?: string) => {
        return readings.filter(
          (r) => r.organizationId === orgId && (!metricKey || r.metricKey === metricKey),
        )
      },
    },
  }
}

const FIXED_TIME = new Date('2026-05-20T12:00:00Z')

describe('MetricRepository', () => {
  let fake: ReturnType<typeof createFakeMetricRepository>

  beforeEach(() => {
    fake = createFakeMetricRepository()
  })

  it('inserts a portal scan reading and retrieves it by organization', async () => {
    await fake.repo.insertReading({
      organizationId: 'org-1',
      propertyId: 'prop-1',
      portalId: 'portal-1',
      metricKey: 'portal.scan',
      value: 1,
      recordedAt: FIXED_TIME,
    })

    const results = await fake.repo.findByOrganizationId('org-1')
    expect(results).toHaveLength(1)
    expect(results[0].metricKey).toBe('portal.scan')
    expect(results[0].value).toBe(1)
    expect(results[0].portalId).toBe('portal-1')
    expect(results[0].recordedAt).toEqual(FIXED_TIME)
  })

  it('inserts a property review reading without portalId', async () => {
    await fake.repo.insertReading({
      organizationId: 'org-1',
      propertyId: 'prop-1',
      portalId: null,
      metricKey: 'property.review',
      value: 4,
      recordedAt: FIXED_TIME,
    })

    const results = await fake.repo.findByOrganizationId('org-1')
    expect(results).toHaveLength(1)
    expect(results[0].metricKey).toBe('property.review')
    expect(results[0].value).toBe(4)
    expect(results[0].portalId).toBeNull()
  })

  it('filters by metric key', async () => {
    await fake.repo.insertReading({
      organizationId: 'org-1',
      propertyId: 'prop-1',
      portalId: 'portal-1',
      metricKey: 'portal.scan',
      value: 1,
      recordedAt: FIXED_TIME,
    })
    await fake.repo.insertReading({
      organizationId: 'org-1',
      propertyId: 'prop-1',
      portalId: 'portal-1',
      metricKey: 'portal.rating',
      value: 5,
      recordedAt: FIXED_TIME,
    })

    const scans = await fake.repo.findByOrganizationId('org-1', 'portal.scan')
    expect(scans).toHaveLength(1)
    expect(scans[0].metricKey).toBe('portal.scan')
  })

  it('isolates tenants — org-2 readings not visible to org-1', async () => {
    await fake.repo.insertReading({
      organizationId: 'org-1',
      propertyId: 'prop-1',
      portalId: 'portal-1',
      metricKey: 'portal.scan',
      value: 1,
      recordedAt: FIXED_TIME,
    })
    await fake.repo.insertReading({
      organizationId: 'org-2',
      propertyId: 'prop-2',
      portalId: 'portal-2',
      metricKey: 'portal.scan',
      value: 1,
      recordedAt: FIXED_TIME,
    })

    const results = await fake.repo.findByOrganizationId('org-1')
    expect(results).toHaveLength(1)
    expect(results[0].organizationId).toBe('org-1')
  })
})
