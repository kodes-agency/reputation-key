// Staff context — listStaffPortals use case tests.
// Covers the forbidden-role gate, portalId dedupe, null-portalId exclusion,
// inactive-portal filtering, and alphabetical sort (D8-008 fan-out logic).

import { describe, it, expect } from 'vitest'
import { listStaffPortals } from './list-staff-portals'
import { createInMemoryStaffAssignmentRepo } from '#/shared/testing/in-memory-staff-assignment-repo'
import { buildTestAuthContext, buildTestStaffAssignment } from '#/shared/testing/fixtures'
import type { StaffPortalLookupPort } from '../ports/portal-lookup.port'
import { isStaffError } from '../../domain/errors'
import { userId, propertyId, portalId } from '#/shared/domain/ids'
import type { UserId, PropertyId, PortalId } from '#/shared/domain/ids'

const TARGET_USER = userId('user-00000000-0000-0000-0000-0000000000aa') as UserId
const TARGET_PROPERTY = propertyId('a0000000-0000-0000-0000-0000000000a1') as PropertyId

/**
 * Fake StaffPortalLookupPort — holds a map of portalId → { name, isActive }
 * and answers getPortalInfo from it. listPortalIdsByProperty is unused by
 * this use case but required by the port type.
 */
const createFakePortalLookup = (
  portals: Readonly<Record<string, { name: string; isActive: boolean }>>,
): StaffPortalLookupPort => ({
  listPortalIdsByProperty: async () => [],
  getPortalInfo: async (_orgId, pid: PortalId) => {
    const entry = portals[String(pid)]
    if (!entry) return null
    return { id: pid, name: entry.name, isActive: entry.isActive }
  },
})

const setup = (
  portals: Readonly<Record<string, { name: string; isActive: boolean }>> = {},
) => {
  const assignmentRepo = createInMemoryStaffAssignmentRepo()
  const portalLookup = createFakePortalLookup(portals)
  const useCase = listStaffPortals({ assignmentRepo, portalLookup })
  return { useCase, assignmentRepo, portalLookup }
}

describe('listStaffPortals', () => {
  it('rejects a role without staff_assignment.read (forbidden)', async () => {
    const { useCase } = setup()
    // Staff has no staff_assignment.read permission.
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(
      useCase({ userId: TARGET_USER, propertyId: TARGET_PROPERTY }, ctx),
    ).rejects.toMatchObject({ code: 'forbidden' })

    // And it throws a tagged StaffError, not a bare Error.
    await expect(
      useCase({ userId: TARGET_USER, propertyId: TARGET_PROPERTY }, ctx),
    ).rejects.toSatisfy(isStaffError)
  })

  it('dedupes duplicate portalIds across assignments', async () => {
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const dupPortal = portalId('p-00000000-0000-0000-0000-000000000001') as PortalId
    const { useCase, assignmentRepo } = setup({
      [String(dupPortal)]: { name: 'Only Portal', isActive: true },
    })

    // Two assignments pointing at the same portalId for the same user/property.
    assignmentRepo.seed([
      buildTestStaffAssignment({
        organizationId: ctx.organizationId,
        userId: TARGET_USER,
        propertyId: TARGET_PROPERTY,
        portalId: dupPortal,
      }),
      buildTestStaffAssignment({
        id: 'c0000000-0000-0000-0000-000000000002',
        organizationId: ctx.organizationId,
        userId: TARGET_USER,
        propertyId: TARGET_PROPERTY,
        portalId: dupPortal,
      }),
    ])

    const result = await useCase(
      { userId: TARGET_USER, propertyId: TARGET_PROPERTY },
      ctx,
    )
    expect(result.portals).toHaveLength(1)
    expect(result.portals[0].id).toBe(dupPortal)
  })

  it('excludes assignments with a null portalId', async () => {
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const withPortal = portalId('p-00000000-0000-0000-0000-000000000010') as PortalId
    const { useCase, assignmentRepo } = setup({
      [String(withPortal)]: { name: 'With Portal', isActive: true },
    })

    // One assignment scoped to a portal, one direct (portalId = null).
    assignmentRepo.seed([
      buildTestStaffAssignment({
        organizationId: ctx.organizationId,
        userId: TARGET_USER,
        propertyId: TARGET_PROPERTY,
        portalId: withPortal,
      }),
      buildTestStaffAssignment({
        id: 'c0000000-0000-0000-0000-000000000002',
        organizationId: ctx.organizationId,
        userId: TARGET_USER,
        propertyId: TARGET_PROPERTY,
        portalId: null,
      }),
    ])

    const result = await useCase(
      { userId: TARGET_USER, propertyId: TARGET_PROPERTY },
      ctx,
    )
    // Only the portal-scoped assignment contributes; the null one is skipped.
    expect(result.portals).toHaveLength(1)
    expect(result.portals[0].id).toBe(withPortal)
  })

  it('filters out inactive portals', async () => {
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const activePortal = portalId('p-00000000-0000-0000-0000-000000000020') as PortalId
    const inactivePortal = portalId('p-00000000-0000-0000-0000-000000000021') as PortalId
    const { useCase, assignmentRepo } = setup({
      [String(activePortal)]: { name: 'Active', isActive: true },
      [String(inactivePortal)]: { name: 'Inactive', isActive: false },
    })

    assignmentRepo.seed([
      buildTestStaffAssignment({
        organizationId: ctx.organizationId,
        userId: TARGET_USER,
        propertyId: TARGET_PROPERTY,
        portalId: activePortal,
      }),
      buildTestStaffAssignment({
        id: 'c00000000-0000-0000-0000-000000000002',
        organizationId: ctx.organizationId,
        userId: TARGET_USER,
        propertyId: TARGET_PROPERTY,
        portalId: inactivePortal,
      }),
    ])

    const result = await useCase(
      { userId: TARGET_USER, propertyId: TARGET_PROPERTY },
      ctx,
    )
    expect(result.portals).toHaveLength(1)
    expect(result.portals[0].id).toBe(activePortal)
  })

  it('sorts portals alphabetically by name', async () => {
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    // Names intentionally out of alphabetical order.
    const zeta = portalId('p-00000000-0000-0000-0000-000000000030') as PortalId
    const alpha = portalId('p-00000000-0000-0000-0000-000000000031') as PortalId
    const middle = portalId('p-00000000-0000-0000-0000-000000000032') as PortalId
    const { useCase, assignmentRepo } = setup({
      [String(zeta)]: { name: 'Zeta Portal', isActive: true },
      [String(alpha)]: { name: 'Alpha Portal', isActive: true },
      [String(middle)]: { name: 'Middle Portal', isActive: true },
    })

    assignmentRepo.seed([
      buildTestStaffAssignment({
        organizationId: ctx.organizationId,
        userId: TARGET_USER,
        propertyId: TARGET_PROPERTY,
        portalId: zeta,
      }),
      buildTestStaffAssignment({
        id: 'c0000000-0000-0000-0000-000000000002',
        organizationId: ctx.organizationId,
        userId: TARGET_USER,
        propertyId: TARGET_PROPERTY,
        portalId: alpha,
      }),
      buildTestStaffAssignment({
        id: 'c0000000-0000-0000-0000-000000000003',
        organizationId: ctx.organizationId,
        userId: TARGET_USER,
        propertyId: TARGET_PROPERTY,
        portalId: middle,
      }),
    ])

    const result = await useCase(
      { userId: TARGET_USER, propertyId: TARGET_PROPERTY },
      ctx,
    )
    expect(result.portals.map((p) => p.name)).toEqual([
      'Alpha Portal',
      'Middle Portal',
      'Zeta Portal',
    ])
  })

  it('returns an empty list when the user has no portal-scoped assignments', async () => {
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const { useCase, assignmentRepo } = setup()

    // Only a direct (null-portal) assignment.
    assignmentRepo.seed([
      buildTestStaffAssignment({
        organizationId: ctx.organizationId,
        userId: TARGET_USER,
        propertyId: TARGET_PROPERTY,
        portalId: null,
      }),
    ])

    const result = await useCase(
      { userId: TARGET_USER, propertyId: TARGET_PROPERTY },
      ctx,
    )
    expect(result.portals).toEqual([])
  })

  it('only considers assignments for the target user + property in the current org', async () => {
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portalForTarget = portalId('p-00000000-0000-0000-0000-000000000040') as PortalId
    const portalForOtherUser = portalId(
      'p-00000000-0000-0000-0000-000000000041',
    ) as PortalId
    const { useCase, assignmentRepo } = setup({
      [String(portalForTarget)]: { name: 'Target Portal', isActive: true },
      [String(portalForOtherUser)]: { name: 'Other Portal', isActive: true },
    })

    assignmentRepo.seed([
      buildTestStaffAssignment({
        organizationId: ctx.organizationId,
        userId: TARGET_USER,
        propertyId: TARGET_PROPERTY,
        portalId: portalForTarget,
      }),
      // Different user, same property — must not leak into the target's listing.
      buildTestStaffAssignment({
        id: 'c0000000-0000-0000-0000-000000000002',
        organizationId: ctx.organizationId,
        userId: userId('user-00000000-0000-0000-0000-0000000000bb') as UserId,
        propertyId: TARGET_PROPERTY,
        portalId: portalForOtherUser,
      }),
    ])

    const result = await useCase(
      { userId: TARGET_USER, propertyId: TARGET_PROPERTY },
      ctx,
    )
    expect(result.portals).toHaveLength(1)
    expect(result.portals[0].id).toBe(portalForTarget)
  })
})
