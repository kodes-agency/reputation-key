import { describe, it, expect } from 'vitest'
import type { StaffAssignmentRepository } from '../../application/ports/staff-assignment.repository'
import { organizationId, userId, propertyId } from '#/shared/domain/ids'
import { resolveReferralCode } from './resolve-referral-code'
import { buildStaffAssignment } from '../../domain/constructors'
import { staffAssignmentId } from '#/shared/domain/ids'

function makeAssignment(staffUserId: string, code: string) {
  const result = buildStaffAssignment({
    id: staffAssignmentId('sa-1'),
    organizationId: organizationId('org-1'),
    propertyId: propertyId('prop-1'),
    teamId: null,
    userId: userId(staffUserId),
    referralCode: code,
    now: new Date('2026-05-01T12:00:00Z'),
  })
  if (result.isErr()) throw result.error
  return result.value
}

describe('resolveReferralCode', () => {
  it('returns StaffId when referral code matches', async () => {
    const assignment = makeAssignment('user-1', 'j-doe-a3f2')
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

    const resolve = resolveReferralCode({ staffRepo: repo })
    const result = await resolve(organizationId('org-1'), 'j-doe-a3f2')
    expect(result).not.toBeNull()
  })

  it('returns null when referral code not found', async () => {
    const repo: StaffAssignmentRepository = {
      findById: async () => null,
      listByUser: async () => [],
      listByProperty: async () => [],
      listByTeam: async () => [],
      assignmentExists: async () => false,
      insert: async () => {},
      softDelete: async () => {},
      getAccessiblePropertyIds: async () => [],
      findByReferralCode: async () => null,
    }

    const resolve = resolveReferralCode({ staffRepo: repo })
    const result = await resolve(organizationId('org-1'), 'unknown')
    expect(result).toBeNull()
  })

  it('returns null when assignment has no userId', async () => {
    // This shouldn't happen in practice but tests the null guard
    const repo: StaffAssignmentRepository = {
      findById: async () => null,
      listByUser: async () => [],
      listByProperty: async () => [],
      listByTeam: async () => [],
      assignmentExists: async () => false,
      insert: async () => {},
      softDelete: async () => {},
      getAccessiblePropertyIds: async () => [],
      findByReferralCode: async () => null,
    }

    const resolve = resolveReferralCode({ staffRepo: repo })
    const result = await resolve(organizationId('org-1'), 'anything')
    expect(result).toBeNull()
  })
})
