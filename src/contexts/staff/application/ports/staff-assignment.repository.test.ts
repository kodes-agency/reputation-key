import { describe, it, expect } from 'vitest'
import type { StaffAssignmentRepository } from './staff-assignment.repository'
import {
  organizationId,
  propertyId,
  staffAssignmentId,
  teamId,
  userId,
} from '#/shared/domain/ids'
import { buildStaffAssignment } from '../../domain/constructors'

function buildAssignment() {
  const result = buildStaffAssignment({
    id: staffAssignmentId('sa-1'),
    organizationId: organizationId('org-1'),
    propertyId: propertyId('prop-1'),
    teamId: teamId('team-1'),
    userId: userId('user-1'),
    referralCode: 'j-doe-a3f2',
    now: new Date('2026-05-01T12:00:00Z'),
  })
  if (result.isErr()) throw result.error
  return result.value
}

describe('StaffAssignmentRepository.findByReferralCode', () => {
  it('finds assignment by referral code', async () => {
    const assignment = buildAssignment()
    const repo: StaffAssignmentRepository = {
      findById: async () => null,
      listByUser: async () => [],
      listByProperty: async () => [],
      listByTeam: async () => [],
      assignmentExists: async () => false,
      insert: async () => {},
      softDelete: async () => {},
      getAccessiblePropertyIds: async () => [],
      findByReferralCode: async (_orgId, code) => {
        if (code === 'j-doe-a3f2') return assignment
        return null
      },
    }

    const result = await repo.findByReferralCode!(organizationId('org-1'), 'j-doe-a3f2')
    expect(result).not.toBeNull()
    expect(result!.referralCode).toBe('j-doe-a3f2')
  })

  it('returns null for unknown referral code', async () => {
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

    const result = await repo.findByReferralCode!(organizationId('org-1'), 'unknown-code')
    expect(result).toBeNull()
  })
})
