import { describe, it, expect } from 'vitest'
import { createStaffAssignment } from './create-staff-assignment'
import { createInMemoryStaffAssignmentRepo } from '#/shared/testing/in-memory-staff-assignment-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isStaffError } from '../../domain/errors'
import type { StaffAssignmentId } from '../../domain/types'
import type { StaffPublicApi } from '../public-api'
import { staffAssignmentId } from '#/shared/domain/ids'
import { userId, propertyId } from '#/shared/domain/ids'

const FIXED_ID = staffAssignmentId(
  'staff-00000000-0000-0000-0000-000000000001',
) as StaffAssignmentId
const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const FIXED_USER = userId('user-00000000-0000-0000-0000-000000000002')
const FIXED_PROPERTY = propertyId('a0000000-0000-0000-0000-000000000001')

const allAccessStaffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
}

const setup = (staffApi: StaffPublicApi = allAccessStaffApi) => {
  const assignmentRepo = createInMemoryStaffAssignmentRepo()
  const events = createCapturingEventBus()

  const deps = {
    assignmentRepo,
    events,
    staffPublicApi: staffApi,
    idGen: () => FIXED_ID,
    clock: () => FIXED_TIME,
  }

  const useCase = createStaffAssignment(deps)
  return { useCase, assignmentRepo, events }
}

describe('createStaffAssignment', () => {
  it('assigns a user to a property directly', async () => {
    const { useCase, assignmentRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const assignment = await useCase(
      { userId: FIXED_USER as string, propertyId: FIXED_PROPERTY as string },
      ctx,
    )

    expect(assignment.userId).toBe(FIXED_USER)
    expect(assignment.propertyId).toBe(FIXED_PROPERTY)
    expect(assignment.teamId).toBeNull()
    expect(assignmentRepo.all()).toHaveLength(1)
  })

  it('assigns a user to a team within a property', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const assignment = await useCase(
      {
        userId: FIXED_USER as string,
        propertyId: FIXED_PROPERTY as string,
        teamId: 'team-00000000-0000-0000-0000-000000000001',
      },
      ctx,
    )

    expect(assignment.teamId).toBeTruthy()
  })

  it('rejects users who cannot manage assignments', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(
      useCase(
        { userId: FIXED_USER as string, propertyId: FIXED_PROPERTY as string },
        ctx,
      ),
    ).rejects.toSatisfy((e) => isStaffError(e) && e.code === 'forbidden')
  })

  it('rejects duplicate assignments', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await useCase(
      { userId: FIXED_USER as string, propertyId: FIXED_PROPERTY as string },
      ctx,
    )

    await expect(
      useCase(
        { userId: FIXED_USER as string, propertyId: FIXED_PROPERTY as string },
        ctx,
      ),
    ).rejects.toSatisfy((e) => isStaffError(e) && e.code === 'already_assigned')
  })

  it('emits staff.assigned event', async () => {
    const { useCase, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await useCase(
      { userId: FIXED_USER as string, propertyId: FIXED_PROPERTY as string },
      ctx,
    )

    expect(events.capturedEvents).toHaveLength(1)
    expect(events.capturedEvents[0]._tag).toBe('staff.assigned')
  })

  it('allows AccountAdmin to self-assign, rejects PropertyManager self-assign', async () => {
    const { useCase, assignmentRepo } = setup()

    // AccountAdmin can self-assign (self-assignment guard bypassed)
    const adminCtx = buildTestAuthContext({ role: 'AccountAdmin' })
    const assignment = await useCase(
      { userId: adminCtx.userId as string, propertyId: FIXED_PROPERTY as string },
      adminCtx,
    )
    expect(assignment.userId).toBe(adminCtx.userId)
    expect(assignmentRepo.all()).toHaveLength(1)

    // PropertyManager cannot self-assign (self-assignment guard enforced — STAFF-01)
    const pmCtx = buildTestAuthContext({ role: 'PropertyManager' })
    await expect(
      useCase(
        { userId: pmCtx.userId as string, propertyId: FIXED_PROPERTY as string },
        pmCtx,
      ),
    ).rejects.toSatisfy(
      (e) =>
        isStaffError(e) && (e.code === 'invalid_input' || e.code === 'already_assigned'),
    )
  })

  it('re-throws non-unique-constraint errors immediately', async () => {
    const assignmentRepo = createInMemoryStaffAssignmentRepo()
    const events = createCapturingEventBus()

    const spiedRepo = {
      ...assignmentRepo,
      insert: async () => {
        throw new Error('connection refused')
      },
    }

    const deps = {
      assignmentRepo: spiedRepo,
      events,
      staffPublicApi: allAccessStaffApi,
      idGen: () => FIXED_ID,
      clock: () => FIXED_TIME,
    }

    const useCase = createStaffAssignment(deps)
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase(
        { userId: FIXED_USER as string, propertyId: FIXED_PROPERTY as string },
        ctx,
      ),
    ).rejects.toThrow('connection refused')
  })
})
