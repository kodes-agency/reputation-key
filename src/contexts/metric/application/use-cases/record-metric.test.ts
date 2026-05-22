import { describe, it, expect } from 'vitest'
import { recordMetric } from './record-metric'
import type { MetricReading } from '../../domain/types'
import { metricReadingId } from '#/shared/domain/ids'
import { organizationId, propertyId, portalId, staffId } from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-01-01')

const createFakeDeps = () => {
  const readings: MetricReading[] = []
  return {
    readings,
    metricRepo: {
      insertReading: async (input: Omit<MetricReading, 'id'>) => {
        const reading: MetricReading = {
          id: metricReadingId(`mr-${readings.length + 1}`),
          ...input,
        }
        readings.push(reading)
        return reading
      },
      findByOrganizationId: async () => [],
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
})
