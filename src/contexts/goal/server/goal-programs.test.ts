import { AsyncLocalStorage } from 'node:async_hooks'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GoalExecutionPolicy } from '../application/use-cases/governed-goals'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  revise: vi.fn(),
  changeStatus: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  createService: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    useCases: { createGoalProgramService: mocks.createService },
    staffPublicApi: { getAssignedPortals: vi.fn(async () => []) },
    portalPublicApi: {
      portalGroup: { findGroupIdsByPortalIds: vi.fn(async () => []) },
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
  createGoalProgram,
  createGoalProgramSchema,
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
    mocks.createService.mockReturnValue({
      create: mocks.create,
      revise: mocks.revise,
      changeStatus: mocks.changeStatus,
      get: mocks.get,
      list: mocks.list,
    })
  })

  it('validates and forwards one program with many canonical subjects', async () => {
    mocks.create.mockResolvedValue({ program: { id: 'program-1' } })

    await withStartContext(() => createGoalProgram({ data: validInput }))

    expect(mocks.create).toHaveBeenCalledWith(validInput, actor)
  })

  it('binds goal.use and the interactive permission to the resolved request', async () => {
    mocks.create.mockResolvedValue({ program: { id: 'program-1' } })
    await withStartContext(() => createGoalProgram({ data: validInput }))
    const policy = mocks.createService.mock.calls[0]?.[0] as GoalExecutionPolicy

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
    expect(mocks.list).toHaveBeenCalledWith(PROPERTY_ID, actor)
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
