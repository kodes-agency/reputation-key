import { describe, it, expect } from 'vitest'
import { metricRecorded } from './events'
import {
  metricReadingId,
  organizationId,
  propertyId,
  portalId,
  portalGroupId,
} from '#/shared/domain/ids'

describe('metricRecorded event', () => {
  it('accepts nullable groupId', () => {
    const withGroup = metricRecorded({
      readingId: metricReadingId('mr-1'),
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: portalId('portal-1'),
      metricKey: 'portal.scan',
      value: 1,
      groupId: portalGroupId('group-1'),
      recordedAt: new Date('2026-01-01'),
    })
    expect(withGroup._tag).toBe('metric.recorded')
    expect(withGroup.groupId).toBe('group-1')

    const withoutGroup = metricRecorded({
      readingId: metricReadingId('mr-2'),
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: null,
      metricKey: 'portal.scan',
      value: 1,
      groupId: null,
      recordedAt: new Date('2026-01-01'),
    })
    expect(withoutGroup.groupId).toBeNull()
  })
})
