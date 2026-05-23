import { describe, it, expect } from 'vitest'
import { scanRecorded, ratingSubmitted, feedbackSubmitted } from './events'
import {
  scanEventId,
  organizationId,
  portalId,
  propertyId,
  staffId,
  ratingId,
  feedbackId,
} from '#/shared/domain/ids'

const base = {
  organizationId: organizationId('org-1'),
  portalId: portalId('portal-1'),
  propertyId: propertyId('prop-1'),
  occurredAt: new Date('2026-01-01'),
}

describe('ScanRecorded event', () => {
  it('accepts nullable staffId', () => {
    const withStaff = scanRecorded({
      ...base,
      scanId: scanEventId('scan-1'),
      source: 'qr',
      staffId: staffId('staff-1'),
    })
    expect(withStaff.staffId).toBe('staff-1')

    const withoutStaff = scanRecorded({
      ...base,
      scanId: scanEventId('scan-2'),
      source: 'qr',
      staffId: null,
    })
    expect(withoutStaff.staffId).toBeNull()
  })
})

describe('RatingSubmitted event', () => {
  it('accepts nullable staffId', () => {
    const withStaff = ratingSubmitted({
      ...base,
      ratingId: ratingId('rating-1'),
      value: 5,
      staffId: staffId('staff-1'),
    })
    expect(withStaff.staffId).toBe('staff-1')

    const withoutStaff = ratingSubmitted({
      ...base,
      ratingId: ratingId('rating-2'),
      value: 4,
      staffId: null,
    })
    expect(withoutStaff.staffId).toBeNull()
  })
})

describe('FeedbackSubmitted event', () => {
  it('accepts nullable staffId', () => {
    const withStaff = feedbackSubmitted({
      ...base,
      feedbackId: feedbackId('fb-1'),
      ratingId: null,
      staffId: staffId('staff-1'),
    })
    expect(withStaff.staffId).toBe('staff-1')

    const withoutStaff = feedbackSubmitted({
      ...base,
      feedbackId: feedbackId('fb-2'),
      ratingId: null,
      staffId: null,
    })
    expect(withoutStaff.staffId).toBeNull()
  })
})
