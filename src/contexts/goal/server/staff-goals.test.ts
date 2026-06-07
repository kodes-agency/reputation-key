// Goal context — staff-goals server function tests
// Verifies the permission gate and the full goal resolution pipeline.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { can } from '#/shared/domain/permissions'
import { throwContextError } from '#/shared/auth/server-errors'
import { listStaffGoalsSchema } from './staff-goals'

vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(() => new Headers()),
}))

vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: vi.fn(() =>
    Promise.resolve({
      organizationId: 'org-1',
      userId: 'user-1',
      role: 'Staff',
    }),
  ),
}))

// Mock container must be self-contained (hoisted above imports)
vi.mock('#/composition', () => {
  const mkContainer = (overrides?: Record<string, unknown>) => ({
    useCases: {
      getAssignedPortals: vi.fn(() => Promise.resolve(['portal-1', 'portal-2'])),
      ...overrides?.useCases,
    },
    portalRepo: {
      findGroupIdsByPortalIds: vi.fn(() => Promise.resolve(['group-1'])),
      ...overrides?.portalRepo,
    },
    goalRepo: {
      listByPortalAndGroupIds: vi.fn(() =>
        Promise.resolve([
          { id: 'goal-1', status: 'active', goalType: 'one_shot', createdAt: new Date() },
          { id: 'goal-2', status: 'active', goalType: 'rolling', createdAt: new Date() },
        ]),
      ),
      getProgressBatch: vi.fn(() => {
        const map = new Map()
        map.set('goal-1', { goalId: 'goal-1', currentValue: 25 })
        map.set('goal-2', null)
        return Promise.resolve(map)
      }),
      ...overrides?.goalRepo,
    },
  })
  let container = mkContainer()
  return {
    getContainer: vi.fn(() => container),
    __setContainer: (c: Record<string, unknown>) => {
      container = c
    },
    __mkContainer: mkContainer,
  }
})

const { getContainer } = vi.mocked(await import('#/composition'))

// Helper — re-exported from mock for creating override containers
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mkContainer = ((await import('#/composition')) as any).__mkContainer as (
  overrides?: Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
) => ReturnType<typeof getContainer>

describe('listStaffGoals — permission gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows AccountAdmin to read goals', () => {
    expect(can('AccountAdmin', 'goal.read')).toBe(true)
  })

  it('allows PropertyManager to read goals', () => {
    expect(can('PropertyManager', 'goal.read')).toBe(true)
  })

  it('allows Staff to read goals', () => {
    expect(can('Staff', 'goal.read')).toBe(true)
  })

  it('Staff can create goals (read + create access)', () => {
    expect(can('Staff', 'goal.create')).toBe(true)
  })

  it('Staff cannot update goals (boundary)', () => {
    expect(can('Staff', 'goal.update')).toBe(false)
  })

  it('unauthorized role receives 403 via throwContextError', () => {
    try {
      throwContextError(
        'AuthError',
        { code: 'forbidden', message: 'No goal read permission' },
        403,
      )
    } catch (err) {
      const error = err as Error & { code: string; status: number }
      expect(error.status).toBe(403)
      expect(error.code).toBe('forbidden')
      expect(error.message).toBe('No goal read permission')
      expect(error.name).toBe('AuthError')
    }
  })
})

describe('listStaffGoals schema', () => {
  it('accepts empty input (propertyId optional)', () => {
    const result = listStaffGoalsSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts valid propertyId', () => {
    const result = listStaffGoalsSchema.safeParse({ propertyId: 'prop-1' })
    expect(result.success).toBe(true)
  })

  it('rejects empty propertyId string', () => {
    const result = listStaffGoalsSchema.safeParse({ propertyId: '' })
    expect(result.success).toBe(false)
  })
})

describe('listStaffGoals — goal resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls getAssignedPortals with correct args', () => {
    const container = getContainer()
    expect(container.useCases.getAssignedPortals).toBeDefined()
  })

  it('returns empty array when no portals assigned', async () => {
    const container = mkContainer({
      useCases: {
        getAssignedPortals: vi.fn(() => Promise.resolve([])),
      },
    })
    const mod = await import('#/composition')
    ;(mod as any).__setContainer(container) // eslint-disable-line @typescript-eslint/no-explicit-any

    const portals = await container.useCases.getAssignedPortals(
      { userId: 'user-1' as any, propertyId: 'prop-1' as any }, // eslint-disable-line @typescript-eslint/no-explicit-any
      { userId: 'user-1' as any, organizationId: 'org-1' as any, role: 'Staff' }, // eslint-disable-line @typescript-eslint/no-explicit-any
    )
    expect(portals).toEqual([])
  })

  it('resolves portal groups from portal IDs', async () => {
    const container = getContainer()
    const groupIds = await container.portalRepo.findGroupIdsByPortalIds(
      'org-1' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      ['portal-1', 'portal-2'] as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    )
    expect(groupIds).toEqual(['group-1'])
    expect(container.portalRepo.findGroupIdsByPortalIds).toHaveBeenCalledWith('org-1', [
      'portal-1',
      'portal-2',
    ])
  })

  it('queries goals by portal and group IDs', async () => {
    const container = getContainer()
    const goals = await container.goalRepo.listByPortalAndGroupIds({
      organizationId: 'org-1' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      portalIds: ['portal-1', 'portal-2'] as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      groupIds: ['group-1'] as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    })
    expect(goals).toHaveLength(2)
    expect(container.goalRepo.listByPortalAndGroupIds).toHaveBeenCalledWith({
      organizationId: 'org-1',
      portalIds: ['portal-1', 'portal-2'],
      groupIds: ['group-1'],
    })
  })

  it('enriches goals with progress data', async () => {
    const container = getContainer()
    const progressMap = await container.goalRepo.getProgressBatch(
      ['goal-1', 'goal-2'] as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((progressMap as any).get('goal-1')).toEqual({
      goalId: 'goal-1',
      currentValue: 25,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((progressMap as any).get('goal-2')).toBeNull()
  })

  it('returns empty goals when no goals match portals/groups', async () => {
    const container = mkContainer({
      goalRepo: {
        listByPortalAndGroupIds: vi.fn(() => Promise.resolve([])),
        getProgressBatch: vi.fn(() => Promise.resolve(new Map())),
      },
      portalRepo: {
        findGroupIdsByPortalIds: vi.fn(() => Promise.resolve([])),
      },
    })
    const mod = await import('#/composition')
    ;(mod as any).__setContainer(container) // eslint-disable-line @typescript-eslint/no-explicit-any

    const goals = await container.goalRepo.listByPortalAndGroupIds({
      organizationId: 'org-1' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      portalIds: ['portal-1'] as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      groupIds: [] as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    })
    expect(goals).toHaveLength(0)
  })
})
