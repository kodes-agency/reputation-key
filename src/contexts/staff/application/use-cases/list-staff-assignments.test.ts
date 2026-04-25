import { describe, it, expect } from 'vitest'
import { listStaffAssignments } from './list-staff-assignments'
import { createInMemoryStaffAssignmentRepo } from '#/shared/testing/in-memory-staff-assignment-repo'
import { buildTestAuthContext, buildTestStaffAssignment } from '#/shared/testing/fixtures'
import { userId, propertyId, teamId } from '#/shared/domain/ids'
import type { UserId, PropertyId } from '#/shared/domain/ids'

const setup = () => {
  const assignmentRepo = createInMemoryStaffAssignmentRepo()
  const useCase = listStaffAssignments({ assignmentRepo })
  return { useCase, assignmentRepo }
}

describe('listStaffAssignments', () => {
  it('returns assignments filtered by propertyId', async () => {
    const { useCase, assignmentRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const targetProperty = propertyId('a0000000-0000-0000-0000-000000000001')
    const otherProperty = propertyId('a0000000-0000-0000-0000-000000000002')

    const a1 = buildTestStaffAssignment({
      organizationId: ctx.organizationId,
      propertyId: targetProperty,
      userId: userId('user-00000000-0000-0000-0000-000000000010') as UserId,
    })
    const a2 = buildTestStaffAssignment({
      id: 'c0000000-0000-0000-0000-000000000002',
      organizationId: ctx.organizationId,
      propertyId: otherProperty,
      userId: userId('user-00000000-0000-0000-0000-000000000011') as UserId,
    })
    assignmentRepo.seed([a1, a2])

    const result = await useCase({ propertyId: targetProperty as PropertyId }, ctx)
    expect(result).toHaveLength(1)
    expect(result[0].propertyId).toBe(targetProperty)
  })

  it('returns assignments filtered by userId', async () => {
    const { useCase, assignmentRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const targetUser = userId('user-00000000-0000-0000-0000-000000000010') as UserId
    const otherUser = userId('user-00000000-0000-0000-0000-000000000011') as UserId

    const a1 = buildTestStaffAssignment({
      organizationId: ctx.organizationId,
      userId: targetUser,
    })
    const a2 = buildTestStaffAssignment({
      id: 'c0000000-0000-0000-0000-000000000002',
      organizationId: ctx.organizationId,
      userId: otherUser,
    })
    assignmentRepo.seed([a1, a2])

    const result = await useCase({ userId: targetUser }, ctx)
    expect(result).toHaveLength(1)
    expect(result[0].userId).toBe(targetUser)
  })

  it('returns empty when no filter is provided', async () => {
    const { useCase, assignmentRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const assignment = buildTestStaffAssignment({ organizationId: ctx.organizationId })
    assignmentRepo.seed([assignment])

    const result = await useCase({}, ctx)
    expect(result).toHaveLength(0)
  })

  it('only returns assignments from the current organization', async () => {
    const { useCase, assignmentRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const targetProperty = propertyId('a0000000-0000-0000-0000-000000000001')

    // Assignment in user's org
    const a1 = buildTestStaffAssignment({
      organizationId: ctx.organizationId,
      propertyId: targetProperty,
    })
    // Assignment in different org
    const a2 = buildTestStaffAssignment({
      id: 'c0000000-0000-0000-0000-000000000002',
      organizationId: 'org-different-0000-0000-0000-000000000001' as never,
      propertyId: targetProperty,
    })
    assignmentRepo.seed([a1, a2])

    const result = await useCase({ propertyId: targetProperty as PropertyId }, ctx)
    expect(result).toHaveLength(1)
    expect(result[0].organizationId).toBe(ctx.organizationId)
  })

  it('returns assignments filtered by teamId', async () => {
    const { useCase, assignmentRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const targetTeam = teamId('10000000-0000-0000-0000-000000000001')
    const otherTeam = teamId('20000000-0000-0000-0000-000000000002')
    const targetProperty = propertyId('a0000000-0000-0000-0000-000000000001')

    // Assignment in target team
    const a1 = buildTestStaffAssignment({
      id: 'c0000000-0000-0000-0000-000000000001',
      organizationId: ctx.organizationId,
      propertyId: targetProperty,
      userId: userId('user-00000000-0000-0000-0000-000000000010') as UserId,
      teamId: targetTeam,
    })
    // Assignment in other team
    const a2 = buildTestStaffAssignment({
      id: 'c0000000-0000-0000-0000-000000000002',
      organizationId: ctx.organizationId,
      propertyId: targetProperty,
      userId: userId('user-00000000-0000-0000-0000-000000000011') as UserId,
      teamId: otherTeam,
    })
    // Direct assignment (no team)
    const a3 = buildTestStaffAssignment({
      id: 'c0000000-0000-0000-0000-000000000003',
      organizationId: ctx.organizationId,
      propertyId: targetProperty,
      userId: userId('user-00000000-0000-0000-0000-000000000012') as UserId,
      teamId: null,
    })
    assignmentRepo.seed([a1, a2, a3])

    const result = await useCase({ teamId: targetTeam }, ctx)
    expect(result).toHaveLength(1)
    expect(result[0].teamId).toBe(targetTeam)
    expect(result[0].userId).toBe(
      userId('user-00000000-0000-0000-0000-000000000010') as UserId,
    )
  })

  it('teamId filter takes precedence over propertyId', async () => {
    const { useCase, assignmentRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const targetTeam = teamId('10000000-0000-0000-0000-000000000001')
    const targetProperty = propertyId('a0000000-0000-0000-0000-000000000001')

    // Assignment in target team on target property
    const a1 = buildTestStaffAssignment({
      id: 'c0000000-0000-0000-0000-000000000001',
      organizationId: ctx.organizationId,
      propertyId: targetProperty,
      teamId: targetTeam,
    })
    // Assignment on target property but no team
    const a2 = buildTestStaffAssignment({
      id: 'c0000000-0000-0000-0000-000000000002',
      organizationId: ctx.organizationId,
      propertyId: targetProperty,
      teamId: null,
    })
    assignmentRepo.seed([a1, a2])

    const result = await useCase({ propertyId: targetProperty, teamId: targetTeam }, ctx)
    // Should only return the team assignment, not the direct one
    expect(result).toHaveLength(1)
    expect(result[0].teamId).toBe(targetTeam)
  })
})
