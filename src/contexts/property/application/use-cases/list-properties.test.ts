// Property context — list properties use case tests

import { describe, it, expect } from 'vitest'
import { listProperties } from './list-properties'
import { createInMemoryPropertyRepo } from '#/shared/testing/in-memory-property-repo'
import { buildTestAuthContext, buildTestProperty } from '#/shared/testing/fixtures'
import type { PropertyId, OrganizationId, UserId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'

/** Create a staffApi stub that returns null for AccountAdmin, specific IDs otherwise. */
const createTestStaffApi = (
  assignments: Map<string, ReadonlyArray<PropertyId>>,
): StaffPublicApi => ({
  getAccessiblePropertyIds: async (
    _orgId: OrganizationId,
    userId: UserId,
    role: Role,
  ) => {
    if (role === 'AccountAdmin') return null // all accessible
    return assignments.get(userId as string) ?? []
  },
})

const setup = () => {
  const propertyRepo = createInMemoryPropertyRepo()
  const staffApi = createTestStaffApi(new Map())
  const useCase = listProperties({ propertyRepo, staffApi })
  return { useCase, propertyRepo }
}

describe('listProperties', () => {
  it('returns all properties for AccountAdmin', async () => {
    const { useCase, propertyRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const p1 = buildTestProperty({ id: 'p1', name: 'Hotel A' })
    const p2 = buildTestProperty({ id: 'p2', name: 'Hotel B' })
    propertyRepo.seed([p1, p2])

    const properties = await useCase(ctx)

    expect(properties).toHaveLength(2)
  })

  it('returns empty array when no properties exist', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const properties = await useCase(ctx)

    expect(properties).toHaveLength(0)
  })

  it('filters to assigned properties for PropertyManager', async () => {
    const propertyRepo = createInMemoryPropertyRepo()
    const p1 = buildTestProperty({ id: 'p1', name: 'Hotel A' })
    const p2 = buildTestProperty({ id: 'p2', name: 'Hotel B' })
    const p3 = buildTestProperty({ id: 'p3', name: 'Hotel C' })
    propertyRepo.seed([p1, p2, p3])

    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    // User is assigned to p1 and p3 only
    const userAssignments = new Map([
      [ctx.userId as string, [p1.id as PropertyId, p3.id as PropertyId]],
    ])
    const staffApi = createTestStaffApi(userAssignments)
    const useCase = listProperties({ propertyRepo, staffApi })

    const properties = await useCase(ctx)

    expect(properties).toHaveLength(2)
    expect(properties.map((p) => p.name).sort()).toEqual(['Hotel A', 'Hotel C'])
  })

  it('filters to assigned properties for Staff', async () => {
    const propertyRepo = createInMemoryPropertyRepo()
    const p1 = buildTestProperty({ id: 'p1' })
    propertyRepo.seed([p1])

    const ctx = buildTestAuthContext({ role: 'Staff' })
    const userAssignments = new Map([
      [ctx.userId as string, []], // no assignments
    ])
    const staffApi = createTestStaffApi(userAssignments)
    const useCase = listProperties({ propertyRepo, staffApi })

    const properties = await useCase(ctx)

    expect(properties).toHaveLength(0)
  })
})
