import { describe, it, expect } from 'vitest'
import { getAssignedPortals } from './get-assigned-portals'
import { createInMemoryStaffAssignmentRepo } from '#/shared/testing/in-memory-staff-assignment-repo'
import { buildTestAuthContext, buildTestStaffAssignment } from '#/shared/testing/fixtures'
import { userId, propertyId, portalId } from '#/shared/domain/ids'
import type { UserId, PropertyId, PortalId } from '#/shared/domain/ids'

const setup = () => {
  const assignmentRepo = createInMemoryStaffAssignmentRepo()
  const useCase = getAssignedPortals({ assignmentRepo })
  return { useCase, assignmentRepo }
}

describe('getAssignedPortals', () => {
  it('returns unique non-null portalIds for a user and property', async () => {
    const { useCase, assignmentRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const targetUser = userId('user-00000000-0000-0000-0000-000000000010') as UserId
    const targetProperty = propertyId(
      'a0000000-0000-0000-0000-000000000001',
    ) as PropertyId
    const portalA = portalId('10000000-0000-0000-0000-000000000001') as PortalId
    const portalB = portalId('20000000-0000-0000-0000-000000000002') as PortalId

    // Two assignments with different portals
    const a1 = buildTestStaffAssignment({
      id: 'c0000000-0000-0000-0000-000000000001',
      organizationId: ctx.organizationId,
      userId: targetUser,
      propertyId: targetProperty,
      portalId: portalA,
    })
    const a2 = buildTestStaffAssignment({
      id: 'c0000000-0000-0000-0000-000000000002',
      organizationId: ctx.organizationId,
      userId: targetUser,
      propertyId: targetProperty,
      portalId: portalB,
    })
    assignmentRepo.seed([a1, a2])

    const result = await useCase({ userId: targetUser, propertyId: targetProperty }, ctx)
    expect(result).toHaveLength(2)
    expect(result).toContain(portalA)
    expect(result).toContain(portalB)
  })

  it('deduplicates duplicate portalIds', async () => {
    const { useCase, assignmentRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const targetUser = userId('user-00000000-0000-0000-0000-000000000010') as UserId
    const targetProperty = propertyId(
      'a0000000-0000-0000-0000-000000000001',
    ) as PropertyId
    const portalA = portalId('10000000-0000-0000-0000-000000000001') as PortalId

    // Two assignments with the same portal
    const a1 = buildTestStaffAssignment({
      id: 'c0000000-0000-0000-0000-000000000001',
      organizationId: ctx.organizationId,
      userId: targetUser,
      propertyId: targetProperty,
      portalId: portalA,
    })
    const a2 = buildTestStaffAssignment({
      id: 'c0000000-0000-0000-0000-000000000002',
      organizationId: ctx.organizationId,
      userId: targetUser,
      propertyId: targetProperty,
      portalId: portalA,
    })
    assignmentRepo.seed([a1, a2])

    const result = await useCase({ userId: targetUser, propertyId: targetProperty }, ctx)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(portalA)
  })

  it('excludes null portalIds', async () => {
    const { useCase, assignmentRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const targetUser = userId('user-00000000-0000-0000-0000-000000000010') as UserId
    const targetProperty = propertyId(
      'a0000000-0000-0000-0000-000000000001',
    ) as PropertyId
    const portalA = portalId('10000000-0000-0000-0000-000000000001') as PortalId

    // One assignment with a portal, one without
    const a1 = buildTestStaffAssignment({
      id: 'c0000000-0000-0000-0000-000000000001',
      organizationId: ctx.organizationId,
      userId: targetUser,
      propertyId: targetProperty,
      portalId: portalA,
    })
    const a2 = buildTestStaffAssignment({
      id: 'c0000000-0000-0000-0000-000000000002',
      organizationId: ctx.organizationId,
      userId: targetUser,
      propertyId: targetProperty,
      portalId: null,
    })
    assignmentRepo.seed([a1, a2])

    const result = await useCase({ userId: targetUser, propertyId: targetProperty }, ctx)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(portalA)
  })

  it('returns empty array when no assignments exist', async () => {
    const { useCase, assignmentRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const targetUser = userId('user-00000000-0000-0000-0000-000000000010') as UserId
    const targetProperty = propertyId(
      'a0000000-0000-0000-0000-000000000001',
    ) as PropertyId

    // Seed an assignment for a different user
    const otherUser = userId('user-00000000-0000-0000-0000-000000000099') as UserId
    const a1 = buildTestStaffAssignment({
      id: 'c0000000-0000-0000-0000-000000000001',
      organizationId: ctx.organizationId,
      userId: otherUser,
      propertyId: targetProperty,
      portalId: portalId('10000000-0000-0000-0000-000000000001') as PortalId,
    })
    assignmentRepo.seed([a1])

    const result = await useCase({ userId: targetUser, propertyId: targetProperty }, ctx)
    expect(result).toHaveLength(0)
  })

  it('only returns assignments from the current organization', async () => {
    const { useCase, assignmentRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const targetUser = userId('user-00000000-0000-0000-0000-000000000010') as UserId
    const targetProperty = propertyId(
      'a0000000-0000-0000-0000-000000000001',
    ) as PropertyId
    const portalA = portalId('10000000-0000-0000-0000-000000000001') as PortalId

    // Assignment in user's org
    const a1 = buildTestStaffAssignment({
      id: 'c0000000-0000-0000-0000-000000000001',
      organizationId: ctx.organizationId,
      userId: targetUser,
      propertyId: targetProperty,
      portalId: portalA,
    })
    // Assignment in different org (same user, property, portal)
    const a2 = buildTestStaffAssignment({
      id: 'c0000000-0000-0000-0000-000000000002',
      organizationId: 'org-different-0000-0000-0000-000000000001' as never,
      userId: targetUser,
      propertyId: targetProperty,
      portalId: portalA,
    })
    assignmentRepo.seed([a1, a2])

    const result = await useCase({ userId: targetUser, propertyId: targetProperty }, ctx)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(portalA)
  })

  it('throws forbidden for unauthorized roles', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Guest' as never })

    await expect(
      useCase(
        {
          userId: userId('user-00000000-0000-0000-0000-000000000010') as UserId,
          propertyId: propertyId('a0000000-0000-0000-0000-000000000001') as PropertyId,
        },
        ctx,
      ),
    ).rejects.toThrow('No staff assignment read permission')
  })
})
