import { AsyncLocalStorage } from 'node:async_hooks'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GoalExecutionPolicy } from '../application/ports/goal-execution-policy'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  revise: vi.fn(),
  changeAssignments: vi.fn(),
  changeStatus: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  getAssignedPortals: vi.fn(),
  findGroupIdsByPortalIds: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    goalPublicApi: {
      programs: {
        create: mocks.create,
        revise: mocks.revise,
        changeAssignments: mocks.changeAssignments,
        changeStatus: mocks.changeStatus,
        get: mocks.get,
        list: mocks.list,
      },
    },
    staffPublicApi: { getAssignedPortals: mocks.getAssignedPortals },
    portalPublicApi: {
      portalGroup: { findGroupIdsByPortalIds: mocks.findGroupIdsByPortalIds },
    },
  }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
}))

import {
  changeGoalProgramAssignments,
  createGoalProgram,
  createGoalProgramSchema,
  changeGoalProgramAssignmentsSchema,
  scopeGoalProgramsForStaff,
  listGoalPrograms,
} from './goal-programs'
import type { GoalSubject } from '../domain/goal-program'

const START_KEY = Symbol.for('tanstack-start:start-storage-context')
function withStartContext<T>(fn: () => Promise<T>): Promise<T> {
  const global = globalThis as Record<symbol, AsyncLocalStorage<unknown> | undefined>
  global[START_KEY] ??= new AsyncLocalStorage()
  return global[START_KEY].run({ startOptions: {} }, fn)
}

const ORG_ID = '00000000-0000-4000-8000-000000000001'
const PROPERTY_ID = '00000000-0000-4000-8000-000000000002'
const PORTAL_ID = '00000000-0000-4000-8000-000000000003'
const actor = {
  organizationId: ORG_ID,
  userId: 'manager-1',
  role: 'AccountAdmin',
} as const
const validInput = {
  propertyId: PROPERTY_ID,
  name: 'Monthly private ratings',
  description: null,
  metric: 'portal_rating_average' as const,
  targetValue: 4.5,
  subjects: [{ kind: 'portal' as const, portalId: PORTAL_ID }],
}

describe('canonical Goal Program server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(actor)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
    mocks.getAssignedPortals.mockResolvedValue([])
    mocks.findGroupIdsByPortalIds.mockResolvedValue([])
  })

  it('validates and forwards one program with many canonical subjects', async () => {
    mocks.create.mockResolvedValue({ program: { id: 'program-1' } })

    await withStartContext(() => createGoalProgram({ data: validInput }))

    expect(mocks.create).toHaveBeenCalledWith(expect.any(Object), validInput, actor)
  })

  it('binds goal.use and the interactive permission to the resolved request', async () => {
    mocks.create.mockResolvedValue({ program: { id: 'program-1' } })
    await withStartContext(() => createGoalProgram({ data: validInput }))
    const policy = mocks.create.mock.calls[0]?.[0] as GoalExecutionPolicy

    await policy.authorize({
      actor,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      action: 'goal.create',
    })
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor,
      action: 'goal.create',
      capability: 'goal.use',
      propertyId: PROPERTY_ID,
    })

    await expect(
      policy.authorize({
        actor: { ...actor, userId: 'another-user' },
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        action: 'goal.create',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('returns the canonical bundle list without adapting it to a legacy Goal', async () => {
    const programs = [{ program: { id: 'program-1' } }]
    mocks.list.mockResolvedValue(programs)

    await withStartContext(() => listGoalPrograms({ data: { propertyId: PROPERTY_ID } }))
    expect(mocks.list).toHaveBeenCalledWith(expect.any(Object), PROPERTY_ID, actor)
  })

  it('scopes Goal Programs from current permissions rather than the raw role label', async () => {
    const assignedOnlyActor = {
      ...actor,
      effectivePermissions: new Set(['goal.read']),
      scopeByPermission: new Map([['goal.read', 'assigned-properties']]),
    }
    mocks.resolveTenantContext.mockResolvedValue(assignedOnlyActor)
    mocks.list.mockResolvedValue([])

    await withStartContext(() => listGoalPrograms({ data: { propertyId: PROPERTY_ID } }))

    expect(mocks.getAssignedPortals).toHaveBeenCalledOnce()
    expect(mocks.findGroupIdsByPortalIds).toHaveBeenCalledOnce()

    vi.clearAllMocks()
    const managerAuthorityUnderStaffLabel = {
      ...actor,
      role: 'Staff' as const,
      effectivePermissions: new Set(['goal.read', 'goal.create']),
      scopeByPermission: new Map([
        ['goal.read', 'organization'],
        ['goal.create', 'organization'],
      ]),
    }
    mocks.resolveTenantContext.mockResolvedValue(managerAuthorityUnderStaffLabel)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
    mocks.list.mockResolvedValue([])

    await withStartContext(() => listGoalPrograms({ data: { propertyId: PROPERTY_ID } }))

    expect(mocks.getAssignedPortals).not.toHaveBeenCalled()
    expect(mocks.findGroupIdsByPortalIds).not.toHaveBeenCalled()
  })

  it('rejects empty subjects and count targets are left to domain validation', () => {
    expect(
      createGoalProgramSchema.safeParse({ ...validInput, subjects: [] }).success,
    ).toBe(false)
    expect(
      createGoalProgramSchema.safeParse({
        ...validInput,
        metric: 'portal_rating_count',
        targetValue: 1.5,
      }).success,
    ).toBe(true)
  })

  it('validates and forwards one fenced bulk assignment snapshot', async () => {
    const input = {
      propertyId: PROPERTY_ID,
      programId: '00000000-0000-4000-8000-000000000004',
      expectedVersion: 3,
      add: [{ kind: 'portal' as const, portalId: PORTAL_ID }],
      remove: [],
      selectAllCurrentPortals: true,
      reason: 'Use the current Portal set',
    }
    mocks.changeAssignments.mockResolvedValue({
      programId: input.programId,
      previousVersion: 3,
      currentVersion: 4,
      outcomes: [],
    })

    await withStartContext(() => changeGoalProgramAssignments({ data: input }))

    expect(mocks.changeAssignments).toHaveBeenCalledWith(expect.any(Object), input, actor)
  })

  it('bounds the combined explicit bulk assignment request', () => {
    const subject = { kind: 'portal' as const, portalId: PORTAL_ID }
    expect(
      changeGoalProgramAssignmentsSchema.safeParse({
        propertyId: PROPERTY_ID,
        programId: '00000000-0000-4000-8000-000000000004',
        expectedVersion: 1,
        add: Array.from({ length: 250 }, () => subject),
        remove: [subject],
        selectAllCurrentPortals: false,
        reason: 'Too many explicit selections',
      }).success,
    ).toBe(false)
    expect(
      changeGoalProgramAssignmentsSchema.safeParse({
        propertyId: PROPERTY_ID,
        programId: '00000000-0000-4000-8000-000000000004',
        expectedVersion: 1,
        add: [],
        remove: [],
        selectAllCurrentPortals: false,
        reason: 'No operation',
      }).success,
    ).toBe(false)
  })

  it('returns only the assignments and results a Staff user may see', () => {
    const bundle = (subjects: GoalSubject[]) => ({
      program: { id: JSON.stringify(subjects) },
      assignments: subjects.map((subject, index) => ({
        id: `assignment-${index}`,
        subject,
      })),
      results: subjects.map((_, index) => ({
        id: `result-${index}`,
        assignmentId: `assignment-${index}`,
      })),
    })
    const visible = scopeGoalProgramsForStaff(
      [
        bundle([
          { kind: 'property', propertyId: PROPERTY_ID },
          { kind: 'portal', portalId: 'portal-visible' },
          { kind: 'portal', portalId: 'portal-hidden' },
        ]),
        bundle([{ kind: 'portal_group', portalGroupId: 'group-visible' }]),
        bundle([{ kind: 'portal_group', portalGroupId: 'group-hidden' }]),
      ],
      ['portal-visible'],
      ['group-visible'],
    )

    expect(visible).toHaveLength(2)
    expect(visible[0]?.assignments.map(({ subject }) => subject)).toEqual([
      { kind: 'property', propertyId: PROPERTY_ID },
      { kind: 'portal', portalId: 'portal-visible' },
    ])
    expect(visible[0]?.results.map(({ id }) => id)).toEqual(['result-0', 'result-1'])
    expect(visible[1]?.assignments[0]?.subject).toEqual({
      kind: 'portal_group',
      portalGroupId: 'group-visible',
    })
  })
})
