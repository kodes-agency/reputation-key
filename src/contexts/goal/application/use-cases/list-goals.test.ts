// Goal context — list goals use case tests
// TDD: tests written first (RED), implementation follows (GREEN).
// Verifies listing, filtering, recurring template progress, sorting, and empty results.

import { describe, it, expect } from 'vitest'
import { listGoals } from './list-goals'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { GoalRepository } from '../ports/goal.repository'
import type { Goal, GoalProgress } from '../../domain/types'
import {
  organizationId,
  propertyId,
  portalId,
  goalId,
  goalProgressId,
  userId,
} from '#/shared/domain/ids'

// ── Test fixtures ──────────────────────────────────────────────────────────

const ORG_ID = organizationId('org-001')
const PROP_ID = propertyId('prop-001')
const PORTAL_ID = portalId('portal-001')
const USER_ID = userId('user-001')

const d = (iso: string) => new Date(iso)

const makeGoal = (
  overrides: {
    id: string
  } & Partial<Omit<Goal, 'id'>>,
): Goal => ({
  organizationId: ORG_ID,
  propertyId: PROP_ID,
  portalId: null,
  portalGroupId: null,
  name: `Goal ${overrides.id}`,
  description: null,
  createdBy: USER_ID,
  goalType: 'open',
  aggregationFunction: 'sum',
  metricKey: 'portal.scan',
  targetValue: 10,
  status: 'active',
  periodStart: null,
  periodEnd: null,
  recurrenceRule: null,
  rollingWindowDays: null,
  parentGoalId: null,
  completedAt: null,
  createdAt: d('2026-01-01T00:00:00Z'),
  updatedAt: d('2026-01-01T00:00:00Z'),
  ...overrides,
  id: goalId(overrides.id),
})

const makeProgress = (
  goalIdStr: string,
  overrides?: Partial<GoalProgress>,
): GoalProgress => ({
  id: goalProgressId(`gp-${goalIdStr}`),
  goalId: goalId(goalIdStr),
  organizationId: ORG_ID,
  currentValue: 5,
  currentSum: null,
  currentCount: null,
  lastComputedAt: d('2026-05-01T00:00:00Z'),
  computedSource: 'event_increment',
  ...overrides,
})

// ── Fake repository ────────────────────────────────────────────────────────

const createFakeGoalRepo = (state: {
  goals: Goal[]
  progress: Map<string, GoalProgress>
  instances: Map<string, Goal[]>
}): GoalRepository => ({
  insert: async () => {
    throw new Error('not used')
  },
  getById: async () => null,
  update: async () => null,
  list: async (filter) => {
    return state.goals.filter((g) => {
      if (g.organizationId !== filter.organizationId) return false
      if (g.propertyId !== filter.propertyId) return false
      if (filter.portalId !== undefined && g.portalId !== filter.portalId) return false
      if (filter.status !== undefined && g.status !== filter.status) return false
      if (filter.goalType !== undefined && g.goalType !== filter.goalType) return false
      return true
    })
  },
  listInstances: async (parentId, _orgId) => {
    return state.instances.get(parentId as string) ?? []
  },
  cancelByParent: async () => 0,
  insertProgress: async () => {
    throw new Error('not used')
  },
  getProgress: async (gid, _orgId) => {
    return state.progress.get(gid as string) ?? null
  },
  getProgressBatch: async (ids, _orgId) => {
    const map = new Map()
    for (const id of ids) {
      map.set(id, state.progress.get(id as string) ?? null)
    }
    return map
  },
  listInstancesBatch: async (parentIds, _orgId) => {
    const map = new Map()
    for (const pid of parentIds) {
      map.set(pid, state.instances.get(pid as string) ?? [])
    }
    return map
  },
  updateProgress: async (_gid, _orgId, _data) => null,
  findActiveGoalsByMetric: async () => [],
  upsertProgress: async () => ({
    currentValue: 0,
    currentSum: null,
    currentCount: null,
  }),
  markGoalCompleted: async () => {},
  findAllActiveRecurring: async () => [],
  findAllActiveGlobal: async () => [],
  findActiveRecurringTemplates: async () => [],
  findLatestInstance: async () => null,
  cancelTemplateAndInstances: async () => null,
  createRecurringGoalWithInstance: async () => {},
  createGoalAndProgress: async () => {},
})

// ── Setup helper ───────────────────────────────────────────────────────────

const setup = () => {
  const state: {
    goals: Goal[]
    progress: Map<string, GoalProgress>
    instances: Map<string, Goal[]>
  } = { goals: [], progress: new Map(), instances: new Map() }

  const goalRepo = createFakeGoalRepo(state)
  const staffPublicApi: StaffPublicApi = {
    getAccessiblePropertyIds: async () => null,
    getAssignedPortals: async () => [],
    countAssignmentsByTeam: async () => 0,
  }
  const useCase = listGoals({ goalRepo, staffPublicApi })

  return { state, goalRepo, staffPublicApi, useCase }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('listGoals', () => {
  it('returns all matching goals with progress for a property', async () => {
    const { state, useCase } = setup()

    const g1 = makeGoal({ id: 'g-1' })
    const g2 = makeGoal({ id: 'g-2' })
    state.goals = [g1, g2]
    state.progress.set('g-1', makeProgress('g-1', { currentValue: 3 }))
    state.progress.set('g-2', makeProgress('g-2', { currentValue: 7 }))

    const result = await useCase({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      userId: USER_ID,
      role: 'AccountAdmin',
    })

    const goals = result._unsafeUnwrap()
    expect(goals).toHaveLength(2)
    const ids = goals.map((r) => r.goal.id as string)
    expect(ids).toContain('g-1')
    expect(ids).toContain('g-2')

    const r1 = goals.find((r) => (r.goal.id as string) === 'g-1')!
    expect(r1.progress!.currentValue).toBe(3)
    const r2 = goals.find((r) => (r.goal.id as string) === 'g-2')!
    expect(r2.progress!.currentValue).toBe(7)
  })

  it('filters by status', async () => {
    const { state, useCase } = setup()

    state.goals = [
      makeGoal({ id: 'g-active', status: 'active' }),
      makeGoal({ id: 'g-completed', status: 'completed' }),
    ]

    const result = await useCase({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      userId: USER_ID,
      role: 'AccountAdmin',
      status: 'active',
    })

    const goals = result._unsafeUnwrap()
    expect(goals).toHaveLength(1)
    expect(goals[0].goal.id as string).toBe('g-active')
  })

  it('filters by portalId', async () => {
    const { state, useCase } = setup()

    state.goals = [
      makeGoal({ id: 'g-portal', portalId: PORTAL_ID }),
      makeGoal({ id: 'g-no-portal', portalId: null }),
    ]

    const result = await useCase({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      userId: USER_ID,
      role: 'AccountAdmin',
      portalId: PORTAL_ID,
    })

    const goals = result._unsafeUnwrap()
    expect(goals).toHaveLength(1)
    expect(goals[0].goal.id as string).toBe('g-portal')
  })

  it('includes current instance progress for recurring templates', async () => {
    const { state, useCase } = setup()

    const template = makeGoal({
      id: 'g-template',
      goalType: 'recurring',
      recurrenceRule: { frequency: 'monthly' },
      status: 'active',
    })
    state.goals = [template]

    // Template has no direct progress
    // Active instance has progress
    const instance = makeGoal({
      id: 'g-instance',
      goalType: 'one_shot',
      parentGoalId: template.id,
      status: 'active',
      periodStart: d('2026-05-01T00:00:00Z'),
      periodEnd: d('2026-05-31T23:59:59Z'),
    })
    state.instances.set('g-template', [instance])
    state.progress.set('g-instance', makeProgress('g-instance', { currentValue: 42 }))

    const result = await useCase({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      userId: USER_ID,
      role: 'AccountAdmin',
    })

    const goals = result._unsafeUnwrap()
    expect(goals).toHaveLength(1)
    // The recurring template should use the active instance's progress
    expect(goals[0].progress!.currentValue).toBe(42)
    expect(goals[0].goal.id as string).toBe('g-template')
  })

  it('sorts: active before completed before cancelled', async () => {
    const { state, useCase } = setup()

    const cancelled = makeGoal({
      id: 'g-cancelled',
      status: 'cancelled',
      createdAt: d('2026-04-01T00:00:00Z'),
    })
    const completed = makeGoal({
      id: 'g-completed',
      status: 'completed',
      createdAt: d('2026-03-01T00:00:00Z'),
    })
    const active = makeGoal({
      id: 'g-active',
      status: 'active',
      createdAt: d('2026-02-01T00:00:00Z'),
    })

    state.goals = [cancelled, completed, active]

    const result = await useCase({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      userId: USER_ID,
      role: 'AccountAdmin',
    })

    const goals = result._unsafeUnwrap()
    const statuses = goals.map((r) => r.goal.status)
    // active first, then completed, then cancelled
    expect(statuses).toEqual(['active', 'completed', 'cancelled'])
  })

  it('sorts newest first within each status bucket', async () => {
    const { state, useCase } = setup()

    const activeOld = makeGoal({
      id: 'g-active-old',
      status: 'active',
      createdAt: d('2026-01-01T00:00:00Z'),
    })
    const activeNew = makeGoal({
      id: 'g-active-new',
      status: 'active',
      createdAt: d('2026-03-01T00:00:00Z'),
    })
    const completedOld = makeGoal({
      id: 'g-completed-old',
      status: 'completed',
      createdAt: d('2026-02-01T00:00:00Z'),
    })
    const completedNew = makeGoal({
      id: 'g-completed-new',
      status: 'completed',
      createdAt: d('2026-04-01T00:00:00Z'),
    })

    state.goals = [activeOld, activeNew, completedOld, completedNew]

    const result = await useCase({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      userId: USER_ID,
      role: 'AccountAdmin',
    })

    const goals = result._unsafeUnwrap()
    const ids = goals.map((r) => r.goal.id as string)
    // active newer first, then completed newer first
    expect(ids).toEqual([
      'g-active-new',
      'g-active-old',
      'g-completed-new',
      'g-completed-old',
    ])
  })

  it('returns empty array when no goals match', async () => {
    const { state, useCase } = setup()
    state.goals = []

    const result = await useCase({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      userId: USER_ID,
      role: 'AccountAdmin',
    })

    expect(result._unsafeUnwrap()).toEqual([])
  })

  it('returns forbidden when Staff lacks property access', async () => {
    const state: {
      goals: Goal[]
      progress: Map<string, GoalProgress>
      instances: Map<string, Goal[]>
    } = { goals: [], progress: new Map(), instances: new Map() }
    const goalRepo = createFakeGoalRepo(state)
    const staffPublicApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [],
      getAssignedPortals: async () => [],
      countAssignmentsByTeam: async () => 0,
    }
    const useCase = listGoals({ goalRepo, staffPublicApi })
    state.goals = [makeGoal({ id: 'g-1' })]

    const result = await useCase({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      userId: USER_ID,
      role: 'Staff',
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toEqual({ tag: 'forbidden' })
  })
})
