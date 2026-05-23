import { describe, it, expect } from 'vitest'
import type { ScanEvent, Rating } from '#/contexts/guest/domain/types'
import type { ReferralCodeResolver } from './record-scan-with-ref'
import type { GuestInteractionRepository } from '../ports/guest-interaction.repository'
import { recordScanWithRef } from './record-scan-with-ref'
import { getStaffIdForSession } from './get-staff-id-for-session'
import { submitRating } from './submit-rating'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import {
  organizationId,
  portalId,
  propertyId,
  scanEventId,
  ratingId,
  staffId,
} from '#/shared/domain/ids'

// ---------------------------------------------------------------------------
// In-memory fakes
// ---------------------------------------------------------------------------

/**
 * Fake staff repo (ReferralCodeResolver).
 * Maps referral codes to userId strings.
 */
function makeFakeStaffRepo(mappings: Record<string, string>): ReferralCodeResolver {
  return {
    findByReferralCode: async (_orgId, code) =>
      mappings[code] ? { userId: mappings[code] } : null,
  }
}

/**
 * Full in-memory GuestInteractionRepository.
 * Tracks scans, ratings, and feedback so the integration flow
 * can be verified without DB or HTTP.
 */
function makeFakeGuestRepo() {
  const scans: ScanEvent[] = []
  const ratings: Rating[] = []

  const repo: GuestInteractionRepository & { scans: ScanEvent[]; ratings: Rating[] } = {
    recordScan: async (scan: ScanEvent) => {
      scans.push(scan)
    },
    insertRating: async (rating: Rating) => {
      ratings.push(rating)
    },
    insertFeedback: async () => {},
    hasRated: async (_orgId, sessionId, _portalId) =>
      ratings.some((r) => r.sessionId === sessionId),
    getLatestScanBySession: async (_orgId, sessionId) => {
      // Return the most recent scan for this session
      const sessionScans = scans.filter((s) => s.sessionId === sessionId)
      return sessionScans.length > 0 ? sessionScans[sessionScans.length - 1] : null
    },
    findFeedbackById: async () => null,
    findRatingById: async () => null,
    scans,
    ratings,
  }

  return repo
}

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const orgId = organizationId('org-1')
const portal = portalId('portal-1')
const prop = propertyId('prop-1')
const fixedDate = new Date('2026-05-01T12:00:00Z')

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe('Staff attribution flow (integration)', () => {
  describe('scan WITH referral code → staffId propagated to rating', () => {
    it('records scan with resolved staffId', async () => {
      const staffRepo = makeFakeStaffRepo({ 'j-doe-a3f2': 'user-1' })
      const guestRepo = makeFakeGuestRepo()
      const bus = createCapturingEventBus()

      const record = recordScanWithRef({
        staffRepo,
        guestRepo,
        events: bus,
        idGen: () => scanEventId('scan-1'),
        clock: () => fixedDate,
      })

      await record({
        organizationId: orgId,
        portalId: portal,
        propertyId: prop,
        source: 'qr',
        sessionId: 'session-with-ref',
        ipHash: 'hash123',
        referralCode: 'j-doe-a3f2',
      })

      // Scan was recorded with staffId resolved from referral code
      expect(guestRepo.scans).toHaveLength(1)
      expect(guestRepo.scans[0].staffId).not.toBeNull()
      expect(guestRepo.scans[0].staffId).toEqual(staffId('user-1'))
    })

    it('getStaffIdForSession returns staffId from scan', async () => {
      const staffRepo = makeFakeStaffRepo({ 'j-doe-a3f2': 'user-1' })
      const guestRepo = makeFakeGuestRepo()
      const bus = createCapturingEventBus()

      const record = recordScanWithRef({
        staffRepo,
        guestRepo,
        events: bus,
        idGen: () => scanEventId('scan-1'),
        clock: () => fixedDate,
      })

      await record({
        organizationId: orgId,
        portalId: portal,
        propertyId: prop,
        source: 'qr',
        sessionId: 'session-with-ref',
        ipHash: 'hash123',
        referralCode: 'j-doe-a3f2',
      })

      const getStaffId = getStaffIdForSession({ guestRepo })
      const resolved = await getStaffId(orgId, 'session-with-ref')

      expect(resolved).not.toBeNull()
      expect(resolved).toEqual(staffId('user-1'))
    })

    it('submitRating inherits staffId from session scan', async () => {
      const staffRepo = makeFakeStaffRepo({ 'j-doe-a3f2': 'user-1' })
      const guestRepo = makeFakeGuestRepo()
      const bus = createCapturingEventBus()

      const record = recordScanWithRef({
        staffRepo,
        guestRepo,
        events: bus,
        idGen: () => scanEventId('scan-1'),
        clock: () => fixedDate,
      })

      const sessionId = 'session-with-ref'

      await record({
        organizationId: orgId,
        portalId: portal,
        propertyId: prop,
        source: 'qr',
        sessionId,
        ipHash: 'hash123',
        referralCode: 'j-doe-a3f2',
      })

      // Resolve staffId from session (same flow as server function)
      const getStaffId = getStaffIdForSession({ guestRepo })
      const resolvedStaffId = await getStaffId(orgId, sessionId)

      // Submit rating with the resolved staffId
      const rate = submitRating({
        guestRepo,
        events: bus,
        idGen: () => ratingId('rating-1'),
        clock: () => fixedDate,
      })

      const rating = await rate({
        organizationId: orgId,
        portalId: portal,
        propertyId: prop,
        sessionId,
        value: 5,
        source: 'qr',
        ipHash: 'hash123',
        staffId: resolvedStaffId,
      })

      // Rating has staffId from the referral code resolution
      expect(rating.staffId).not.toBeNull()
      expect(rating.staffId).toEqual(staffId('user-1'))
      expect(guestRepo.ratings).toHaveLength(1)
      expect(guestRepo.ratings[0].staffId).toEqual(staffId('user-1'))
    })

    it('end-to-end: full attribution pipeline', async () => {
      const staffRepo = makeFakeStaffRepo({ 'j-doe-a3f2': 'user-1' })
      const guestRepo = makeFakeGuestRepo()
      const bus = createCapturingEventBus()
      const sessionId = 'session-e2e'

      // Step 1: Scan with referral code
      const record = recordScanWithRef({
        staffRepo,
        guestRepo,
        events: bus,
        idGen: () => scanEventId('scan-e2e'),
        clock: () => fixedDate,
      })

      await record({
        organizationId: orgId,
        portalId: portal,
        propertyId: prop,
        source: 'qr',
        sessionId,
        ipHash: 'hash-e2e',
        referralCode: 'j-doe-a3f2',
      })

      // Step 2: Verify scan has staffId
      expect(guestRepo.scans).toHaveLength(1)
      expect(guestRepo.scans[0].staffId).toEqual(staffId('user-1'))

      // Step 3: Resolve staffId from session
      const getStaffId = getStaffIdForSession({ guestRepo })
      const resolvedStaffId = await getStaffId(orgId, sessionId)
      expect(resolvedStaffId).toEqual(staffId('user-1'))

      // Step 4: Submit rating with resolved staffId
      const rate = submitRating({
        guestRepo,
        events: bus,
        idGen: () => ratingId('rating-e2e'),
        clock: () => fixedDate,
      })

      const rating = await rate({
        organizationId: orgId,
        portalId: portal,
        propertyId: prop,
        sessionId,
        value: 5,
        source: 'qr',
        ipHash: 'hash-e2e',
        staffId: resolvedStaffId,
      })

      // Step 5: Verify rating has correct staffId
      expect(rating.staffId).toEqual(staffId('user-1'))
      expect(guestRepo.ratings[0].staffId).toEqual(staffId('user-1'))

      // Events were emitted for both scan and rating
      expect(bus.capturedEvents).toHaveLength(2)
      expect(bus.capturedEvents[0]._tag).toBe('scan.recorded')
      expect(bus.capturedEvents[1]._tag).toBe('rating.submitted')
    })
  })

  describe('scan WITHOUT referral code → staffId is null', () => {
    it('records scan with null staffId when no referral code', async () => {
      const staffRepo = makeFakeStaffRepo({})
      const guestRepo = makeFakeGuestRepo()
      const bus = createCapturingEventBus()

      const record = recordScanWithRef({
        staffRepo,
        guestRepo,
        events: bus,
        idGen: () => scanEventId('scan-2'),
        clock: () => fixedDate,
      })

      await record({
        organizationId: orgId,
        portalId: portal,
        propertyId: prop,
        source: 'qr',
        sessionId: 'session-no-ref',
        ipHash: 'hash456',
        referralCode: null,
      })

      expect(guestRepo.scans).toHaveLength(1)
      expect(guestRepo.scans[0].staffId).toBeNull()
    })

    it('getStaffIdForSession returns null for session without referral', async () => {
      const staffRepo = makeFakeStaffRepo({})
      const guestRepo = makeFakeGuestRepo()
      const bus = createCapturingEventBus()

      const record = recordScanWithRef({
        staffRepo,
        guestRepo,
        events: bus,
        idGen: () => scanEventId('scan-2'),
        clock: () => fixedDate,
      })

      const sessionId = 'session-no-ref'

      await record({
        organizationId: orgId,
        portalId: portal,
        propertyId: prop,
        source: 'qr',
        sessionId,
        ipHash: 'hash456',
        referralCode: null,
      })

      const getStaffId = getStaffIdForSession({ guestRepo })
      const resolved = await getStaffId(orgId, sessionId)

      expect(resolved).toBeNull()
    })

    it('rating has null staffId when session had no referral code', async () => {
      const staffRepo = makeFakeStaffRepo({})
      const guestRepo = makeFakeGuestRepo()
      const bus = createCapturingEventBus()
      const sessionId = 'session-no-ref'

      // Scan without referral code
      const record = recordScanWithRef({
        staffRepo,
        guestRepo,
        events: bus,
        idGen: () => scanEventId('scan-2'),
        clock: () => fixedDate,
      })

      await record({
        organizationId: orgId,
        portalId: portal,
        propertyId: prop,
        source: 'qr',
        sessionId,
        ipHash: 'hash456',
        referralCode: null,
      })

      // Resolve staffId — should be null
      const getStaffId = getStaffIdForSession({ guestRepo })
      const resolvedStaffId = await getStaffId(orgId, sessionId)
      expect(resolvedStaffId).toBeNull()

      // Submit rating with null staffId
      const rate = submitRating({
        guestRepo,
        events: bus,
        idGen: () => ratingId('rating-2'),
        clock: () => fixedDate,
      })

      const rating = await rate({
        organizationId: orgId,
        portalId: portal,
        propertyId: prop,
        sessionId,
        value: 4,
        source: 'qr',
        ipHash: 'hash456',
        staffId: resolvedStaffId,
      })

      expect(rating.staffId).toBeNull()
      expect(guestRepo.ratings).toHaveLength(1)
      expect(guestRepo.ratings[0].staffId).toBeNull()
    })
  })
})
