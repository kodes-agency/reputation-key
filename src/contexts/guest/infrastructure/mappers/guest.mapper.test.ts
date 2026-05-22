// Guest context — guest mapper tests
// Tests the scanEventToRow, ratingToRow, and feedbackToRow mappers.
// These are simple field-to-field mappers with branded ID → string casts.
// Verifies all fields are preserved correctly.

import { describe, it, expect } from 'vitest'
import { scanEventToRow, ratingToRow, feedbackToRow } from './guest.mapper'
import {
  scanEventId,
  ratingId,
  feedbackId,
  organizationId,
  portalId,
  propertyId,
} from '#/shared/domain/ids'
import type { ScanEvent, Rating, Feedback } from '../../domain/types'

// ── Test fixtures ─────────────────────────────────────────────────

function buildTestScanEvent(overrides?: Partial<ScanEvent>): ScanEvent {
  return {
    id: scanEventId('scan-001'),
    organizationId: organizationId('org-001'),
    portalId: portalId('20000000-0000-0000-0000-000000000001'),
    propertyId: propertyId('30000000-0000-0000-0000-000000000001'),
    source: 'qr',
    sessionId: 'session-abc',
    ipHash: 'hash123',
    staffId: null,
    createdAt: new Date('2026-05-01T12:00:00Z'),
    ...overrides,
  }
}

function buildTestRating(overrides?: Partial<Rating>): Rating {
  return {
    id: ratingId('rating-001'),
    organizationId: organizationId('org-001'),
    portalId: portalId('20000000-0000-0000-0000-000000000001'),
    propertyId: propertyId('30000000-0000-0000-0000-000000000001'),
    sessionId: 'session-abc',
    value: 5,
    source: 'qr',
    ipHash: 'hash456',
    staffId: null,
    createdAt: new Date('2026-05-01T12:00:00Z'),
    ...overrides,
  }
}

function buildTestFeedback(overrides?: Partial<Feedback>): Feedback {
  return {
    id: feedbackId('feedback-001'),
    organizationId: organizationId('org-001'),
    portalId: portalId('20000000-0000-0000-0000-000000000001'),
    propertyId: propertyId('30000000-0000-0000-0000-000000000001'),
    sessionId: 'session-abc',
    ratingId: null,
    comment: 'Great service!',
    source: 'nfc',
    ipHash: 'hash789',
    staffId: null,
    createdAt: new Date('2026-05-01T12:00:00Z'),
    ...overrides,
  }
}

// ── scanEventToRow ────────────────────────────────────────────────

describe('scanEventToRow', () => {
  it('preserves all fields', () => {
    const scan = buildTestScanEvent()
    const row = scanEventToRow(scan)

    expect(row.id).toBe('scan-001')
    expect(row.organizationId).toBe('org-001')
    expect(row.portalId).toBe('20000000-0000-0000-0000-000000000001')
    expect(row.propertyId).toBe('30000000-0000-0000-0000-000000000001')
    expect(row.source).toBe('qr')
    expect(row.sessionId).toBe('session-abc')
    expect(row.ipHash).toBe('hash123')
    expect(row.staffId).toBeNull()
    expect(row.createdAt).toEqual(new Date('2026-05-01T12:00:00Z'))
  })

  it('preserves all fields with overridden values', () => {
    const scan = buildTestScanEvent({
      source: 'nfc',
      sessionId: 'different-session',
    })
    const row = scanEventToRow(scan)

    expect(row.source).toBe('nfc')
    expect(row.sessionId).toBe('different-session')
  })
})

// ── ratingToRow ───────────────────────────────────────────────────

describe('ratingToRow', () => {
  it('preserves all fields including value', () => {
    const rating = buildTestRating()
    const row = ratingToRow(rating)

    expect(row.id).toBe('rating-001')
    expect(row.organizationId).toBe('org-001')
    expect(row.portalId).toBe('20000000-0000-0000-0000-000000000001')
    expect(row.propertyId).toBe('30000000-0000-0000-0000-000000000001')
    expect(row.sessionId).toBe('session-abc')
    expect(row.value).toBe(5)
    expect(row.source).toBe('qr')
    expect(row.ipHash).toBe('hash456')
    expect(row.staffId).toBeNull()
    expect(row.createdAt).toEqual(new Date('2026-05-01T12:00:00Z'))
  })

  it('preserves different rating values', () => {
    const rating = buildTestRating({ value: 1 })
    const row = ratingToRow(rating)
    expect(row.value).toBe(1)
  })

  it('preserves different sources', () => {
    const rating = buildTestRating({ source: 'direct' })
    const row = ratingToRow(rating)
    expect(row.source).toBe('direct')
  })
})

// ── feedbackToRow ─────────────────────────────────────────────────

describe('feedbackToRow', () => {
  it('preserves all fields with null ratingId', () => {
    const fb = buildTestFeedback()
    const row = feedbackToRow(fb)

    expect(row.id).toBe('feedback-001')
    expect(row.organizationId).toBe('org-001')
    expect(row.portalId).toBe('20000000-0000-0000-0000-000000000001')
    expect(row.propertyId).toBe('30000000-0000-0000-0000-000000000001')
    expect(row.sessionId).toBe('session-abc')
    expect(row.ratingId).toBeNull()
    expect(row.comment).toBe('Great service!')
    expect(row.source).toBe('nfc')
    expect(row.ipHash).toBe('hash789')
    expect(row.staffId).toBeNull()
    expect(row.createdAt).toEqual(new Date('2026-05-01T12:00:00Z'))
  })

  it('preserves all fields with non-null ratingId', () => {
    const fb = buildTestFeedback({
      ratingId: ratingId('10000000-0000-0000-0000-000000000001'),
    })
    const row = feedbackToRow(fb)

    expect(row.ratingId).toBe('10000000-0000-0000-0000-000000000001')
    expect(row.comment).toBe('Great service!')
  })

  it('preserves different comments', () => {
    const fb = buildTestFeedback({ comment: 'Could be better' })
    const row = feedbackToRow(fb)
    expect(row.comment).toBe('Could be better')
  })
})
