import { describe, it, expect } from 'vitest'
import { removeStaffAssignment } from './remove-staff-assignment'
import { createInMemoryStaffAssignmentRepo } from '#/shared/testing/in-memory-staff-assignment-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext, buildTestStaffAssignment } from '#/shared/testing/fixtures'
import { isStaffError } from '../../domain/errors'
import { staffAssignmentId } from '#/shared/domain/ids'
import type { StaffAssignmentId } from '../../domain/types'

const FIXED_TIME = new Date('2026-04-15T12:00:00Z')

const setup = () => {
  const assignmentRepo = createInMemoryStaffAssignmentRepo()
  const events = createCapturingEventBus()
  const useCase = removeStaffAssignment({
    assignmentRepo,
    events,
    clock: () => FIXED_TIME,
  })
  return { useCase, assignmentRepo, events }
}

describe('removeStaffAssignment', () => {
  it('soft-deletes an assignment', async () => {
    const { useCase, assignmentRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const assignment = buildTestStaffAssignment({ organizationId: ctx.organizationId })
    assignmentRepo.seed([assignment])

    await useCase({ assignmentId: assignment.id as StaffAssignmentId }, ctx)

    const found = await assignmentRepo.findById(
      ctx.organizationId,
      assignment.id as StaffAssignmentId,
    )
    expect(found).toBeNull()
  })

  it('rejects users who cannot manage assignments', async () => {
    const { useCase, assignmentRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })
    const assignment = buildTestStaffAssignment({ organizationId: ctx.organizationId })
    assignmentRepo.seed([assignment])

    await expect(
      useCase({ assignmentId: assignment.id as StaffAssignmentId }, ctx),
    ).rejects.toSatisfy((e) => isStaffError(e) && e.code === 'forbidden')
  })

  it('rejects when assignment not found', async () => {
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      removeStaffAssignment({
        assignmentRepo: createInMemoryStaffAssignmentRepo(),
        events: createCapturingEventBus(),
        clock: () => FIXED_TIME,
      })({ assignmentId: staffAssignmentId('nonexistent') }, ctx),
    ).rejects.toSatisfy((e) => isStaffError(e) && e.code === 'assignment_not_found')
  })

  it('emits staff.unassigned event', async () => {
    const { useCase, assignmentRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const assignment = buildTestStaffAssignment({ organizationId: ctx.organizationId })
    assignmentRepo.seed([assignment])

    await useCase({ assignmentId: assignment.id as StaffAssignmentId }, ctx)

    expect(events.capturedEvents).toHaveLength(1)
    expect(events.capturedEvents[0]._tag).toBe('staff.unassigned')
  })

  it('does not remove assignment from another organization', async () => {
    const { useCase, assignmentRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    // Assignment belongs to a different org
    const assignment = buildTestStaffAssignment({
      organizationId: 'org-different-0000-0000-0000-000000000001' as never,
    })
    assignmentRepo.seed([assignment])

    await expect(
      useCase({ assignmentId: assignment.id as StaffAssignmentId }, ctx),
    ).rejects.toSatisfy((e) => isStaffError(e) && e.code === 'assignment_not_found')
  })
})
