import { describe, it, expect } from 'vitest'
import type { GuestInteractionRepository } from '../ports/guest-interaction.repository'
import type { ScanEvent } from '../../domain/types'
import { getStaffIdForSession } from './get-staff-id-for-session'
import {
  organizationId,
  portalId,
  propertyId,
  scanEventId,
  staffId,
} from '#/shared/domain/ids'

function makeScan(sid: string | null): ScanEvent {
  return {
    id: scanEventId('scan-1'),
    organizationId: organizationId('org-1'),
    portalId: portalId('portal-1'),
    propertyId: propertyId('prop-1'),
    source: 'qr',
    sessionId: 'session-abc',
    ipHash: 'hash123',
    staffId: sid ? staffId(sid) : null,
    createdAt: new Date('2026-05-01T12:00:00Z'),
  }
}

const orgId = organizationId('org-1')

describe('getStaffIdForSession', () => {
  it('returns staffId from latest scan', async () => {
    const repo: GuestInteractionRepository = {
      recordScan: async () => {},
      insertRating: async () => {},
      insertFeedback: async () => {},
      hasRated: async () => false,
      getLatestScanBySession: async () => makeScan('staff-1'),
    }

    const fn = getStaffIdForSession({ guestRepo: repo })
    const result = await fn(orgId, 'session-abc')
    expect(result).not.toBeNull()
  })

  it('returns null when no scan found', async () => {
    const repo: GuestInteractionRepository = {
      recordScan: async () => {},
      insertRating: async () => {},
      insertFeedback: async () => {},
      hasRated: async () => false,
      getLatestScanBySession: async () => null,
    }

    const fn = getStaffIdForSession({ guestRepo: repo })
    const result = await fn(orgId, 'session-abc')
    expect(result).toBeNull()
  })

  it('returns null when scan has no staffId', async () => {
    const repo: GuestInteractionRepository = {
      recordScan: async () => {},
      insertRating: async () => {},
      insertFeedback: async () => {},
      hasRated: async () => false,
      getLatestScanBySession: async () => makeScan(null),
    }

    const fn = getStaffIdForSession({ guestRepo: repo })
    const result = await fn(orgId, 'session-abc')
    expect(result).toBeNull()
  })
})
