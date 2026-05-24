// Goal context — get goal use case tests
// TDD: tests written first (RED), implementation follows (GREEN).
// Verifies fetching a single goal with progress and optional instance history.

import { describe, it, expect } from 'vitest'
import { getGoal } from './get-goal'
import type { GoalRepository } from '../ports/goal.repository'
import type { Goal, GoalProgress } from '../../domain/types'
import {
  organizationId,
  propertyId,
  goalId,
  goalProgressId,
  userId,
} from '#/shared/domain/ids'

// ── Test fixtures ──────────────────────────────────────────────────────────

const ORG_ID = organizationId('org-001')
const OTHER_ORG_ID = organizationId('org-999')
const PROP_ID = propertyId('prop-001')
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
  teamId: null,
  staffId: null,
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
  getById: async (id, orgId) => {
    return state.goals.find((g) => g.id === id && g.organizationId === orgId) ?? null
  },
  update: async () => null,
  list: async () => [],
  listInstances: async (parentId, _orgId) => {
    return state.instances.get(parentId as string) ?? []
  },
  cancelByParent: async () => 0,
  insertProgress: async () => {
    throw new Error('not used')
  },
  getProgress: async (gid) => {
    return state.progress.get(gid as string) ?? null
  },
  getProgressBatch: async (ids) => {
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
  updateProgress: async () => null,
  findActiveGoalsByMetric: async () => [],
  upsertProgress: async () => ({
      currentValue: 0,
      currentSum: null,
      currentCount: null,
    }),
    incrementProgress: async () => ({
    currentValue: 0,
    currentSum: null,
    currentCount: null,
  }),
  markGoalCompleted: async () => {},
  findAllActive: async () => [],
  findActiveRecurringTemplates: async () => [],
  findLatestInstance: async () => null,
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
  const useCase = getGoal({ goalRepo })

  return { state, goalRepo, useCase }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('getGoal', () => {
  it('returns goal with progress for an open goal', async () => {
    const { state, useCase } = setup()

    const goal = makeGoal({ id: 'g-1', goalType: 'open' })
    state.goals = [goal]
    state.progress.set('g-1', makeProgress('g-1', { currentValue: 7 }))

    const result = await useCase({
      goalId: goal.id,
      organizationId: ORG_ID,
      role: 'AccountAdmin',
    })

    expect(result.isOk()).toBe(true)
    const detail = result._unsafeUnwrap()
    expect(detail.goal.id).toBe(goal.id)
    expect(detail.progress!.currentValue).toBe(7)
    expect(detail.instances).toBeUndefined()
  })

  it('returns goal with progress and instance history for a recurring template', async () => {
    const { state, useCase } = setup()

    const template = makeGoal({
      id: 'g-template',
      goalType: 'recurring',
      recurrenceRule: { frequency: 'monthly' },
    })
    state.goals = [template]
    // Template has no direct progress
    // No progress for template itself

    const instance1 = makeGoal({
      id: 'g-inst-1',
      goalType: 'one_shot',
      parentGoalId: template.id,
      periodStart: d('2026-04-01T00:00:00Z'),
      periodEnd: d('2026-04-30T23:59:59Z'),
      createdAt: d('2026-04-01T00:00:00Z'),
    })
    const instance2 = makeGoal({
      id: 'g-inst-2',
      goalType: 'one_shot',
      parentGoalId: template.id,
      periodStart: d('2026-05-01T00:00:00Z'),
      periodEnd: d('2026-05-31T23:59:59Z'),
      createdAt: d('2026-05-01T00:00:00Z'),
    })

    state.instances.set('g-template', [instance2, instance1])
    state.progress.set('g-inst-1', makeProgress('g-inst-1', { currentValue: 10 }))
    state.progress.set('g-inst-2', makeProgress('g-inst-2', { currentValue: 20 }))

    const result = await useCase({
      goalId: template.id,
      organizationId: ORG_ID,
      role: 'AccountAdmin',
    })

    expect(result.isOk()).toBe(true)
    const detail = result._unsafeUnwrap()
    expect(detail.goal.id).toBe(template.id)
    expect(detail.progress).toBeNull()
    expect(detail.instances).toBeDefined()
    expect(detail.instances!).toHaveLength(2)
    // Instances sorted by periodStart desc → inst-2 first
    expect(detail.instances![0].goal.id as string).toBe('g-inst-2')
    expect(detail.instances![0].progress!.currentValue).toBe(20)
    expect(detail.instances![1].goal.id as string).toBe('g-inst-1')
    expect(detail.instances![1].progress!.currentValue).toBe(10)
  })

  it('returns err when goal does not exist', async () => {
    const { useCase } = setup()

    const result = await useCase({
      goalId: goalId('nonexistent'),
      organizationId: ORG_ID,
      role: 'AccountAdmin',
    })

    expect(result.isErr()).toBe(true)
  })

  it('returns err when goal belongs to a different organization', async () => {
    const { state, useCase } = setup()

    const goal = makeGoal({ id: 'g-1' })
    state.goals = [goal]

    const result = await useCase({
      goalId: goal.id,
      organizationId: OTHER_ORG_ID,
      role: 'AccountAdmin',
    })

    expect(result.isErr()).toBe(true)
  })

  it('returns forbidden for role without goal.read permission', async () => {
    const { state, useCase } = setup()

    const goal = makeGoal({ id: 'g-1' })
    state.goals = [goal]

    const result = await useCase({
      goalId: goal.id,
      organizationId: ORG_ID,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally invalid role to test permission guard
      role: 'Guest' as any,
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toEqual({ tag: 'forbidden' })
  })
})
