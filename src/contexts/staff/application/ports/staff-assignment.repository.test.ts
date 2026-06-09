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
    now: new Date('2026-05-01T12:00:00Z'),
  })
  if (result.isErr()) throw result.error
  return result.value
}

describe('StaffAssignmentRepository', () => {
  it('can satisfy the port interface', async () => {
    const assignment = buildAssignment()
    const repo: StaffAssignmentRepository = {
      findById: async () => assignment,
      listByUser: async () => [assignment],
      listByProperty: async () => [assignment],
      listByTeam: async () => [assignment],
      listByUserAndProperty: async () => [assignment],
      assignmentExists: async () => true,
      insert: async () => {},
      softDelete: async () => {},
      getAccessiblePropertyIds: async () => [propertyId('prop-1')],
    }

    const found = await repo.findById(organizationId('org-1'), staffAssignmentId('sa-1'))
    expect(found).not.toBeNull()
    expect(found!.id).toBe('sa-1')
  })
})
