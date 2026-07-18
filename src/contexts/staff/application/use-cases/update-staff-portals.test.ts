import { describe, it, expect } from 'vitest'
import { updateStaffPortals } from './update-staff-portals'
import { createInMemoryStaffAssignmentRepo } from '#/shared/testing/in-memory-staff-assignment-repo'
import { createSequentialStaffCommandStore } from '#/shared/testing/sequential-staff-command-store'
import { buildTestAuthContext, buildTestStaffAssignment } from '#/shared/testing/fixtures'
import { userId, propertyId, portalId } from '#/shared/domain/ids'
import type { UserId, PropertyId, PortalId } from '#/shared/domain/ids'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import type { StaffPublicApi } from '../public-api'
import { isStaffError } from '../../domain/errors'

const setup = (accessible: ReadonlyArray<PropertyId> | null = null) => {
  const assignmentRepo = createInMemoryStaffAssignmentRepo()
  const captured: DomainEvent[] = []
  const mockEventBus: EventBus = {
    on: () => {},
    emit: async (event) => {
      captured.push(event)
    },
    clear: () => {
      captured.length = 0
    },
  }
  let nextId = 0
  const idGen = () => `gen-${++nextId}`
  const clock = () => new Date('2026-06-01T12:00:00Z')

  const useCase = updateStaffPortals({
    assignmentRepo,
    portalLookup: {
      // Permissive mock — all test portal IDs are valid for any property
      listPortalIdsByProperty: async () => [portalA, portalB, portalC],
      getPortalInfo: async () => null,
    },
    commandStore: createSequentialStaffCommandStore({
      repo: assignmentRepo,
      events: mockEventBus,
    }),
    staffPublicApi: {
      getAccessiblePropertyIds: async () => accessible,
      getAssignedPortals: async () => [],
      countAssignmentsByTeam: async () => 0,
    } satisfies StaffPublicApi,
    clock,
    idGen,
  })

  return {
    useCase,
    assignmentRepo,
    captured,
    idGen,
    mockEventBus,
    resetId: () => {
      nextId = 0
    },
  }
}

const actingUser = userId('user-acting-0000-0000-0000-000000000001') as UserId
const targetUser = userId('user-target-0000-0000-0000-000000000002') as UserId
const targetProperty = propertyId('a0000000-0000-0000-0000-000000000001') as PropertyId
const portalA = portalId('10000000-0000-0000-0000-000000000001') as PortalId
const portalB = portalId('20000000-0000-0000-0000-000000000002') as PortalId
const portalC = portalId('30000000-0000-0000-0000-000000000003') as PortalId

describe('updateStaffPortals', () => {
  it('adds new portal assignments (user has 0, adds 3)', async () => {
    const { useCase, captured, assignmentRepo } = setup()
    const ctx = buildTestAuthContext({ userId: actingUser, role: 'PropertyManager' })

    const result = await useCase(
      {
        userId: targetUser,
        propertyId: targetProperty,
        portalIds: [portalA, portalB, portalC],
      },
      ctx,
    )

    expect(result.added).toBe(3)
    expect(result.removed).toBe(0)

    // 3 assigned events emitted
    expect(captured).toHaveLength(3)
    expect(captured.every((e) => e._tag === 'staff.assigned')).toBe(true)

    // Repo has 3 assignments
    const assignments = await assignmentRepo.listByUserAndProperty(
      ctx.organizationId,
      targetUser,
      targetProperty,
    )
    expect(assignments).toHaveLength(3)
  })

  it('removes old portal assignments (user has 3, removes 2)', async () => {
    const { useCase, captured, assignmentRepo } = setup()
    const ctx = buildTestAuthContext({ userId: actingUser, role: 'PropertyManager' })

    // Seed 3 existing assignments
    const a1 = buildTestStaffAssignment({
      id: 'c0000001-0000-0000-0000-000000000001',
      organizationId: ctx.organizationId,
      userId: targetUser,
      propertyId: targetProperty,
      portalId: portalA,
    })
    const a2 = buildTestStaffAssignment({
      id: 'c0000002-0000-0000-0000-000000000002',
      organizationId: ctx.organizationId,
      userId: targetUser,
      propertyId: targetProperty,
      portalId: portalB,
    })
    const a3 = buildTestStaffAssignment({
      id: 'c0000003-0000-0000-0000-000000000003',
      organizationId: ctx.organizationId,
      userId: targetUser,
      propertyId: targetProperty,
      portalId: portalC,
    })
    assignmentRepo.seed([a1, a2, a3])

    // Keep only portalA
    const result = await useCase(
      { userId: targetUser, propertyId: targetProperty, portalIds: [portalA] },
      ctx,
    )

    expect(result.added).toBe(0)
    expect(result.removed).toBe(2)

    // 2 unassigned events emitted
    expect(captured).toHaveLength(2)
    expect(captured.every((e) => e._tag === 'staff.unassigned')).toBe(true)
  })

  it('mixed add + remove (user has [A,B], new set is [B,C])', async () => {
    const { useCase, captured, assignmentRepo } = setup()
    const ctx = buildTestAuthContext({ userId: actingUser, role: 'PropertyManager' })

    // Seed A and B
    const a1 = buildTestStaffAssignment({
      id: 'c0000001-0000-0000-0000-000000000001',
      organizationId: ctx.organizationId,
      userId: targetUser,
      propertyId: targetProperty,
      portalId: portalA,
    })
    const a2 = buildTestStaffAssignment({
      id: 'c0000002-0000-0000-0000-000000000002',
      organizationId: ctx.organizationId,
      userId: targetUser,
      propertyId: targetProperty,
      portalId: portalB,
    })
    assignmentRepo.seed([a1, a2])

    // Desired: [B, C] → remove A, add C
    const result = await useCase(
      { userId: targetUser, propertyId: targetProperty, portalIds: [portalB, portalC] },
      ctx,
    )

    expect(result.added).toBe(1)
    expect(result.removed).toBe(1)

    // 1 assigned + 1 unassigned
    expect(captured).toHaveLength(2)
    const tags = captured.map((e) => e._tag)
    expect(tags).toContain('staff.assigned')
    expect(tags).toContain('staff.unassigned')
  })

  it('no changes → no events emitted', async () => {
    const { useCase, captured, assignmentRepo } = setup()
    const ctx = buildTestAuthContext({ userId: actingUser, role: 'PropertyManager' })

    // Seed A and B
    const a1 = buildTestStaffAssignment({
      id: 'c0000001-0000-0000-0000-000000000001',
      organizationId: ctx.organizationId,
      userId: targetUser,
      propertyId: targetProperty,
      portalId: portalA,
    })
    const a2 = buildTestStaffAssignment({
      id: 'c0000002-0000-0000-0000-000000000002',
      organizationId: ctx.organizationId,
      userId: targetUser,
      propertyId: targetProperty,
      portalId: portalB,
    })
    assignmentRepo.seed([a1, a2])

    // Same set: [A, B]
    const result = await useCase(
      { userId: targetUser, propertyId: targetProperty, portalIds: [portalA, portalB] },
      ctx,
    )

    expect(result.added).toBe(0)
    expect(result.removed).toBe(0)
    expect(captured).toHaveLength(0)
  })

  it('throws on self-assignment (actingUserId === userId)', async () => {
    const { useCase } = setup()
    // ctx.userId is the default actingUser; use same user as target
    const ctx = buildTestAuthContext({ userId: actingUser, role: 'PropertyManager' })

    await expect(
      useCase(
        { userId: actingUser, propertyId: targetProperty, portalIds: [portalA] },
        ctx,
      ),
    ).rejects.toThrow('Cannot assign yourself to a property')
  })

  it('all events from one call share the same correlationId', async () => {
    const { useCase, captured, assignmentRepo } = setup()
    const ctx = buildTestAuthContext({ userId: actingUser, role: 'PropertyManager' })

    // Seed A
    const a1 = buildTestStaffAssignment({
      id: 'c0000001-0000-0000-0000-000000000001',
      organizationId: ctx.organizationId,
      userId: targetUser,
      propertyId: targetProperty,
      portalId: portalA,
    })
    assignmentRepo.seed([a1])

    // Change to [B, C] — remove A, add B + C = 3 events total
    await useCase(
      { userId: targetUser, propertyId: targetProperty, portalIds: [portalB, portalC] },
      ctx,
    )

    expect(captured).toHaveLength(3)

    const correlationIds = captured.map((e) =>
      'correlationId' in e
        ? String((e as Record<string, unknown>).correlationId)
        : 'none',
    )
    // All correlationIds must be the same
    const uniqueCorrelationIds = new Set(correlationIds)
    expect(uniqueCorrelationIds.size).toBe(1)
    // correlationId must be non-null
    expect([...uniqueCorrelationIds][0]).not.toBeNull()
  })

  it('throws forbidden for unauthorized roles', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ userId: actingUser, role: 'Guest' as never })

    await expect(
      useCase(
        { userId: targetUser, propertyId: targetProperty, portalIds: [portalA] },
        ctx,
      ),
    ).rejects.toThrow('this role cannot manage staff assignments')
  })

  it('rejects PropertyManager without assignment to the target property (D6-001)', async () => {
    // PM passes can('staff_assignment.create'/'delete'); isPropertyAccessible must
    // reject before any portal assignment is added or removed.
    const { useCase } = setup([])
    const ctx = buildTestAuthContext({ userId: actingUser, role: 'PropertyManager' })

    await expect(
      useCase(
        { userId: targetUser, propertyId: targetProperty, portalIds: [portalA] },
        ctx,
      ),
    ).rejects.toSatisfy((e) => isStaffError(e) && e.code === 'forbidden')
  })
})
