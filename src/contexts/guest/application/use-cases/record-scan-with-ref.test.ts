import { describe, it, expect } from 'vitest'
import type { StaffAssignmentRepository } from '#/contexts/staff/application/ports/staff-assignment.repository'
import type { ScanEvent } from '#/contexts/guest/domain/types'
import { recordScanWithRef } from './record-scan-with-ref'
import {
  organizationId,
  portalId,
  propertyId,
  scanEventId,
  userId,
  staffAssignmentId,
} from '#/shared/domain/ids'
import { buildStaffAssignment } from '#/contexts/staff/domain/constructors'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'

function makeAssignment(code: string, uid: string) {
  const result = buildStaffAssignment({
    id: staffAssignmentId('sa-1'),
    organizationId: organizationId('org-1'),
    propertyId: propertyId('prop-1'),
    teamId: null,
    userId: userId(uid),
    referralCode: code,
    now: new Date('2026-05-01T12:00:00Z'),
  })
  if (result.isErr()) throw result.error
  return result.value
}

function makeFakeStaffRepo(assignment: ReturnType<typeof makeAssignment> | null) {
  const repo: StaffAssignmentRepository = {
    findById: async () => null,
    listByUser: async () => [],
    listByProperty: async () => [],
    listByTeam: async () => [],
    assignmentExists: async () => false,
    insert: async () => {},
    softDelete: async () => {},
    getAccessiblePropertyIds: async () => [],
    findByReferralCode: async () => assignment,
  }
  return repo
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
    scans,
  }
}

describe('recordScanWithRef', () => {
  it('resolves referral code and passes staffId to recordScan', async () => {
    const assignment = makeAssignment('j-doe-a3f2', 'user-1')
    const staffRepo = makeFakeStaffRepo(assignment)
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
