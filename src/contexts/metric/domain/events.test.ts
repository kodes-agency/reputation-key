import { describe, it, expect } from 'vitest'
import { metricRecorded } from './events'
import {
  metricReadingId,
  organizationId,
  propertyId,
  portalId,
  staffId,
} from '#/shared/domain/ids'

describe('metricRecorded event', () => {
  it('accepts nullable staffId', () => {
    const withStaff = metricRecorded({
      readingId: metricReadingId('mr-1'),
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: portalId('portal-1'),
      metricKey: 'portal.scan',
      value: 1,
      staffId: staffId('staff-1'),
      recordedAt: new Date('2026-01-01'),
    })
    expect(withStaff._tag).toBe('metric.recorded')
    expect(withStaff.staffId).toBe('staff-1')

    const withoutStaff = metricRecorded({
      readingId: metricReadingId('mr-2'),
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: null,
      metricKey: 'portal.scan',
      value: 1,
      staffId: null,
      recordedAt: new Date('2026-01-01'),
    })
    expect(withoutStaff.staffId).toBeNull()
  })
})
