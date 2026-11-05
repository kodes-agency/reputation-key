import { describe, it, expect } from 'vitest'
import { scanEventToRow } from './guest.mapper'
import { scanEventId, organizationId, portalId, propertyId } from '#/shared/domain/ids'
import type { ScanEvent } from '../../domain/types'

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
    createdAt: new Date('2026-05-01T12:00:00Z'),
    ...overrides,
  }
}

// ── scanEventToRow ────────────────────────────────────────────────

describe('scanEventToRow', () => {
  it('keeps the retired abuse-pseudonym slot null', () => {
    const scan = buildTestScanEvent()
    const row = scanEventToRow(scan)

    expect(row.id).toBe('scan-001')
    expect(row.organizationId).toBe('org-001')
    expect(row.portalId).toBe('20000000-0000-0000-0000-000000000001')
    expect(row.propertyId).toBe('30000000-0000-0000-0000-000000000001')
    expect(row.source).toBe('qr')
    expect(row.sessionId).toBe('session-abc')
    expect(row.ipHash).toBeNull()
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
