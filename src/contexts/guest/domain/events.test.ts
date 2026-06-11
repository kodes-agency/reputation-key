import { describe, it, expect } from 'vitest'
import { guestScanRecorded, guestRatingSubmitted, guestFeedbackSubmitted } from './events'
import {
  scanEventId,
  organizationId,
  portalId,
  propertyId,
  ratingId,
  feedbackId,
} from '#/shared/domain/ids'

const base = {
  eventId: 'test-event-1',
  organizationId: organizationId('org-1'),
  portalId: portalId('portal-1'),
  propertyId: propertyId('prop-1'),
  occurredAt: new Date('2026-01-01'),
}

describe('GuestScanRecorded event', () => {
  it('creates event with valid payload', () => {
    const event = guestScanRecorded({
      ...base,
      scanId: scanEventId('scan-1'),
      source: 'qr',
    })
    expect(event.scanId).toBe('scan-1')
    expect(event.source).toBe('qr')
  })
})

describe('GuestRatingSubmitted event', () => {
  it('creates event with valid payload', () => {
    const event = guestRatingSubmitted({
      ...base,
      ratingId: ratingId('rating-1'),
      value: 5,
    })
    expect(event.ratingId).toBe('rating-1')
    expect(event.value).toBe(5)
  })
})

describe('GuestFeedbackSubmitted event', () => {
  it('creates event with valid payload', () => {
    const event = guestFeedbackSubmitted({
      ...base,
      feedbackId: feedbackId('fb-1'),
      ratingId: null,
    })
    expect(event.feedbackId).toBe('fb-1')
  })
})
