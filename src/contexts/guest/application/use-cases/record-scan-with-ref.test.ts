import { describe, it, expect } from 'vitest'
import type { ScanEvent } from '#/contexts/guest/domain/types'
import type { ReferralCodeResolver } from './record-scan-with-ref'
import { recordScanWithRef } from './record-scan-with-ref'
import { organizationId, portalId, propertyId, scanEventId } from '#/shared/domain/ids'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'

function makeFakeStaffRepo(userId: string | null) {
  const resolver: ReferralCodeResolver = {
    findByReferralCode: async () => (userId ? { userId } : null),
  }
  return resolver
}

function makeFakeGuestRepo() {
  const scans: ScanEvent[] = []
  return {
    recordScan: async (scan: ScanEvent) => {
      scans.push(scan)
    },
    insertRating: async () => {},
    insertFeedback: async () => {},
    hasRated: async () => false,
    getLatestScanBySession: async () => null,
    scans,
  }
}

describe('recordScanWithRef', () => {
  it('resolves referral code and passes staffId to recordScan', async () => {
    const staffRepo = makeFakeStaffRepo('user-1')
    const guestRepo = makeFakeGuestRepo()
    const bus = createCapturingEventBus()

    const record = recordScanWithRef({
      staffRepo,
      guestRepo,
      events: bus,
      idGen: () => scanEventId('scan-1'),
      clock: () => new Date('2026-05-01T12:00:00Z'),
    })

    await record({
      organizationId: organizationId('org-1'),
      portalId: portalId('portal-1'),
      propertyId: propertyId('prop-1'),
      source: 'qr',
      sessionId: 'session-abc',
      ipHash: 'hash123',
      referralCode: 'j-doe-a3f2',
    })

    expect(guestRepo.scans).toHaveLength(1)
    expect(guestRepo.scans[0].staffId).not.toBeNull()
  })

  it('passes null staffId when referral code not provided', async () => {
    const staffRepo = makeFakeStaffRepo(null)
    const guestRepo = makeFakeGuestRepo()
    const bus = createCapturingEventBus()

    const record = recordScanWithRef({
      staffRepo,
      guestRepo,
      events: bus,
      idGen: () => scanEventId('scan-1'),
      clock: () => new Date('2026-05-01T12:00:00Z'),
    })

    await record({
      organizationId: organizationId('org-1'),
      portalId: portalId('portal-1'),
      propertyId: propertyId('prop-1'),
      source: 'qr',
      sessionId: 'session-abc',
      ipHash: 'hash123',
      referralCode: null,
    })

    expect(guestRepo.scans).toHaveLength(1)
    expect(guestRepo.scans[0].staffId).toBeNull()
  })

  it('passes null staffId when referral code not found', async () => {
    const staffRepo = makeFakeStaffRepo(null)
    const guestRepo = makeFakeGuestRepo()
    const bus = createCapturingEventBus()

    const record = recordScanWithRef({
      staffRepo,
      guestRepo,
      events: bus,
      idGen: () => scanEventId('scan-1'),
      clock: () => new Date('2026-05-01T12:00:00Z'),
    })

    await record({
      organizationId: organizationId('org-1'),
      portalId: portalId('portal-1'),
      propertyId: propertyId('prop-1'),
      source: 'qr',
      sessionId: 'session-abc',
      ipHash: 'hash123',
      referralCode: 'unknown-code',
    })

    expect(guestRepo.scans).toHaveLength(1)
    expect(guestRepo.scans[0].staffId).toBeNull()
  })
})
