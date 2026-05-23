// Guest context — guest mapper tests
// Tests the scanEventToRow, ratingToRow, and feedbackToRow mappers.
// These are simple field-to-field mappers with branded ID → string casts.
// Verifies all fields are preserved correctly.

import { describe, it, expect } from 'vitest'
import {
  scanEventToRow,
  scanEventFromRow,
  ratingToRow,
  feedbackToRow,
} from './guest.mapper'
import {
  scanEventId,
  ratingId,
  feedbackId,
  organizationId,
  portalId,
  propertyId,
  staffId,
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

// ── scanEventFromRow ──────────────────────────────────────────────

describe('scanEventFromRow', () => {
  it('maps a DB row to a ScanEvent domain object', () => {
    const row = {
      id: 'scan-001',
      organizationId: 'org-001',
      portalId: '20000000-0000-0000-0000-000000000001',
      propertyId: '30000000-0000-0000-0000-000000000001',
      source: 'qr',
      sessionId: 'session-abc',
      ipHash: 'hash123',
      staffId: null,
      createdAt: new Date('2026-05-01T12:00:00Z'),
    }

    const result = scanEventFromRow(row)

    expect(result).toEqual({
      id: scanEventId('scan-001'),
      organizationId: organizationId('org-001'),
      portalId: portalId('20000000-0000-0000-0000-000000000001'),
      propertyId: propertyId('30000000-0000-0000-0000-000000000001'),
      source: 'qr',
      sessionId: 'session-abc',
      ipHash: 'hash123',
      staffId: null,
      createdAt: new Date('2026-05-01T12:00:00Z'),
    })
  })

  it('converts a non-null staffId string into a branded StaffId', () => {
    const row = {
      id: 'scan-002',
      organizationId: 'org-001',
      portalId: '20000000-0000-0000-0000-000000000001',
      propertyId: '30000000-0000-0000-0000-000000000001',
      source: 'nfc',
      sessionId: 'session-def',
      ipHash: 'hash456',
      staffId: 'staff-999',
      createdAt: new Date('2026-05-02T08:30:00Z'),
    }

    const result = scanEventFromRow(row)

    expect(result.staffId).not.toBeNull()
    expect(result.staffId).toEqual(staffId('staff-999'))
  })
})

// ── scanEvent round-trip with non-null staffId ───────────────────

describe('scanEvent round-trip (scanEventToRow → scanEventFromRow)', () => {
  it('preserves non-null staffId through toRow then fromRow', () => {
    const original = buildTestScanEvent({
      staffId: staffId('staff-42'),
    })

    const row = scanEventToRow(original)
    expect(row.staffId).toBe('staff-42')

    const restored = scanEventFromRow(row)
    expect(restored.staffId).toEqual(staffId('staff-42'))
    expect(restored).toEqual(original)
  })

  it('preserves null staffId through toRow then fromRow', () => {
    const original = buildTestScanEvent()
    expect(original.staffId).toBeNull()

    const row = scanEventToRow(original)
    expect(row.staffId).toBeNull()

    const restored = scanEventFromRow(row)
    expect(restored.staffId).toBeNull()
    expect(restored).toEqual(original)
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

  it('preserves non-null staffId', () => {
    const rating = buildTestRating({ staffId: staffId('staff-100') })
    const row = ratingToRow(rating)
    expect(row.staffId).toBe('staff-100')
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

  it('preserves non-null staffId', () => {
    const fb = buildTestFeedback({ staffId: staffId('staff-200') })
    const row = feedbackToRow(fb)
    expect(row.staffId).toBe('staff-200')
  })
})
