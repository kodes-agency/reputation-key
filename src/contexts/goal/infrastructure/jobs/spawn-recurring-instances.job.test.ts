// Goal context — spawn-recurring-instances job tests
// Verifies: spawning next instance, idempotency, monthly & weekly calendar anchoring.

import { describe, it, expect } from 'vitest'
import {
  createSpawnRecurringInstancesHandler,
  type SpawnRecurringInstancesDeps,
  type SpawnSummary,
} from './spawn-recurring-instances.job'
import type { GoalRepository } from '../../application/ports/goal.repository'
import type { Goal, GoalProgress } from '../../domain/types'
import type { EventBus } from '#/shared/events/event-bus'
import { organizationId, propertyId, goalId, userId } from '#/shared/domain/ids'

// ── Helpers ──────────────────────────────────────────────────────────────

const ORG_ID = organizationId('org-1')
const PROP_ID = propertyId('prop-1')
const USER_ID = userId('user-1')

/** Shortcut for UTC dates. */
const d = (iso: string) => new Date(iso)

/** Build a recurring template goal (parentGoalId === null). */
const makeTemplate = (overrides: Partial<Goal> & { id: Goal['id'] }): Goal => ({
  organizationId: ORG_ID,
  propertyId: PROP_ID,
  portalId: null,
  groupId: null,
  name: 'Monthly scans',
  description: null,
  createdBy: USER_ID,
  goalType: 'recurring',
  aggregationFunction: 'sum',
  metricKey: 'portal.scan',
  targetValue: 100,
  status: 'active',
  periodStart: null,
  periodEnd: null,
  recurrenceRule: { frequency: 'monthly' },
  rollingWindowDays: null,
  parentGoalId: null,
  completedAt: null,
  createdAt: d('2026-01-01T00:00:00Z'),
  updatedAt: d('2026-01-01T00:00:00Z'),
  ...overrides,
})

/** Build a recurring instance goal (has parentGoalId, periodStart, periodEnd). */
const makeInstance = (overrides: Partial<Goal> & { id: Goal['id'] }): Goal => ({
  organizationId: ORG_ID,
  propertyId: PROP_ID,
  portalId: null,
  groupId: null,
  name: 'Monthly scans',
  description: null,
  createdBy: USER_ID,
  goalType: 'recurring',
  aggregationFunction: 'sum',
  metricKey: 'portal.scan',
  targetValue: 100,
  status: 'active',
  periodStart: d('2026-05-01T00:00:00Z'),
  periodEnd: d('2026-05-31T23:59:59Z'),
  recurrenceRule: { frequency: 'monthly' },
  rollingWindowDays: null,
  parentGoalId: goalId('template-1'),
  completedAt: null,
  createdAt: d('2026-05-01T00:00:00Z'),
  updatedAt: d('2026-05-01T00:00:00Z'),
  ...overrides,
})

/** Create a fake job object (only _unused by handler). */
const fakeJob = { id: 'test-job' } as unknown as import('bullmq').Job

/** Build deps with controllable state. */
function createFakeDeps(state: {
  templates: Goal[]
  latestInstance: Map<string, Goal | null>
  now: Date
}) {
  const created: Array<{ goal: Goal; progress: GoalProgress }> = []

  const goalRepo: GoalRepository = {
    insert: async () => {
      throw new Error('not used')
    },
    getById: async () => null,
    update: async () => null,
    list: async () => [],
    listInstances: async () => [],
    cancelByParent: async () => 0,
    cancelGoalWithInstances: async () => null,
    insertProgress: async () => {
      throw new Error('not used')
    },
    getProgress: async () => null,
    getProgressBatch: async (ids) => {
      const map = new Map()
      for (const id of ids) {
        map.set(id, null)
      }
      return map
    },
    listInstancesBatch: async (parentIds) => {
      const map = new Map()
      for (const pid of parentIds) {
        map.set(pid, [])
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
    findAllActiveAcrossTenants: async () => state.templates,
    findActiveRecurringTemplates: async () => state.templates,
    findLatestInstance: async (parentId) =>
      state.latestInstance.get(parentId as string) ?? null,
    listByPortalAndGroupIds: async () => [],
    createGoalAndProgress: async (goal, progress) => {
      created.push({ goal, progress })
    },
    createTemplateInstanceAndProgress: async (_template, instance, progress) => {
      created.push({ goal: instance, progress })
    },
  }

  const eventBus: EventBus = {
    on: () => {},
    emit: async () => {},
    clear: () => {},
  }

  let idCounter = 0
  const deps: SpawnRecurringInstancesDeps = {
    goalRepo,
    events: eventBus,
    clock: () => state.now,
    idGen: () => `spawned-${++idCounter}`,
  }

  return { deps, created, state }
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('spawn-recurring-instances job', () => {
  // ── Spawning ─────────────────────────────────────────────────────────

  describe('spawning next instance', () => {
    it('spawns a new instance when latest instance ends within 1 day of now', async () => {
      // Template with monthly recurrence
      const template = makeTemplate({ id: goalId('template-1') })

      // Latest instance ends "tomorrow" (May 31 → June 1 is next period start)
      // NOW = June 1 2026 00:00 UTC → next period start = June 1 → within 1 day
      const instance = makeInstance({
        id: goalId('instance-may'),
        parentGoalId: template.id,
        periodStart: d('2026-05-01T00:00:00Z'),
        periodEnd: d('2026-05-31T23:59:59Z'),
      })

      const { deps, created } = createFakeDeps({
        templates: [template],
        latestInstance: new Map([['template-1', instance]]),
        now: d('2026-06-01T00:00:00Z'), // Next period start is exactly NOW
      })

      const handler = createSpawnRecurringInstancesHandler(deps)
      const result: SpawnSummary = await handler(fakeJob)

      expect(result.templatesChecked).toBe(1)
      expect(result.spawned).toBe(1)
      expect(created).toHaveLength(1)

      // Verify the spawned instance
      const { goal, progress } = created[0]!
      expect(goal.parentGoalId).toBe(template.id)
      expect(goal.periodStart).toEqual(d('2026-06-01T00:00:00Z'))
      expect(goal.periodEnd).toEqual(d('2026-06-30T23:59:59.999Z'))
      expect(progress.goalId).toBe(goal.id)
      expect(progress.currentValue).toBe(0)
    })

    it('does NOT spawn when next period start is more than 1 day away', async () => {
      const template = makeTemplate({ id: goalId('template-1') })

      // Instance ends May 31, next start = June 1
      // But NOW is May 28 → June 1 is 4 days away → too early
      const instance = makeInstance({
        id: goalId('instance-may'),
        parentGoalId: template.id,
        periodStart: d('2026-05-01T00:00:00Z'),
        periodEnd: d('2026-05-31T23:59:59Z'),
      })

      const { deps, created } = createFakeDeps({
        templates: [template],
        latestInstance: new Map([['template-1', instance]]),
        now: d('2026-05-28T00:00:00Z'),
      })

      const handler = createSpawnRecurringInstancesHandler(deps)
      const result = await handler(fakeJob)

      expect(result.templatesChecked).toBe(1)
      expect(result.spawned).toBe(0)
      expect(created).toHaveLength(0)
    })
  })

  // ── Idempotency ──────────────────────────────────────────────────────

  describe('idempotent execution', () => {
    it('does not create duplicate when run twice (latest instance updated)', async () => {
      const template = makeTemplate({ id: goalId('template-1') })

      // First run: May instance, next start = June 1
      const mayInstance = makeInstance({
        id: goalId('instance-may'),
        parentGoalId: template.id,
        periodStart: d('2026-05-01T00:00:00Z'),
        periodEnd: d('2026-05-31T23:59:59Z'),
      })

      const latestMap = new Map<string, Goal | null>([['template-1', mayInstance]])

      const { deps, created } = createFakeDeps({
        templates: [template],
        latestInstance: latestMap,
        now: d('2026-06-01T00:00:00Z'),
      })

      const handler = createSpawnRecurringInstancesHandler(deps)

      // First run → spawns June instance
      const result1 = await handler(fakeJob)
      expect(result1.spawned).toBe(1)
      expect(created).toHaveLength(1)

      // Simulate that the June instance was persisted and is now the latest
      const juneInstance = makeInstance({
        id: goalId('instance-june'),
        parentGoalId: template.id,
        periodStart: d('2026-06-01T00:00:00Z'),
        periodEnd: d('2026-06-30T23:59:59Z'),
      })
      latestMap.set('template-1', juneInstance)

      // Second run → June instance ends June 30, next start = July 1
      // NOW is still June 1 → July 1 is 30 days away → no spawn
      const result2 = await handler(fakeJob)
      expect(result2.spawned).toBe(0)
      expect(created).toHaveLength(1) // Still only 1
    })
  })

  // ── Monthly calendar anchoring ───────────────────────────────────────

  describe('monthly calendar anchoring', () => {
    it('spawns next month instance anchored to 1st of month', async () => {
      const template = makeTemplate({
        id: goalId('template-monthly'),
        recurrenceRule: { frequency: 'monthly' },
      })

      // January instance ends Jan 31, next start = Feb 1
      const janInstance = makeInstance({
        id: goalId('instance-jan'),
        parentGoalId: template.id,
        periodStart: d('2026-01-01T00:00:00Z'),
        periodEnd: d('2026-01-31T23:59:59Z'),
        recurrenceRule: { frequency: 'monthly' },
      })

      const { deps, created } = createFakeDeps({
        templates: [template],
        latestInstance: new Map([['template-monthly', janInstance]]),
        now: d('2026-02-01T00:00:00Z'),
      })

      const handler = createSpawnRecurringInstancesHandler(deps)
      await handler(fakeJob)

      expect(created).toHaveLength(1)
      const { goal } = created[0]!
      // February 2026: Feb 1 – Feb 28
      expect(goal.periodStart).toEqual(d('2026-02-01T00:00:00Z'))
      expect(goal.periodEnd).toEqual(d('2026-02-28T23:59:59.999Z'))
    })
  })

  // ── Weekly (Mon–Sun) calendar anchoring ──────────────────────────────

  describe('weekly calendar anchoring (Mon–Sun)', () => {
    it('spawns next week instance starting on Monday', async () => {
      const template = makeTemplate({
        id: goalId('template-weekly'),
        recurrenceRule: { frequency: 'weekly' },
      })

      // Week of Mon Jun 15 – Sun Jun 21, 2026
      // Next start = Monday Jun 22
      const weekInstance = makeInstance({
        id: goalId('instance-w25'),
        parentGoalId: template.id,
        periodStart: d('2026-06-15T00:00:00Z'),
        periodEnd: d('2026-06-21T23:59:59Z'),
        recurrenceRule: { frequency: 'weekly' },
      })

      const { deps, created } = createFakeDeps({
        templates: [template],
        latestInstance: new Map([['template-weekly', weekInstance]]),
        now: d('2026-06-22T00:00:00Z'), // Monday Jun 22
      })

      const handler = createSpawnRecurringInstancesHandler(deps)
      await handler(fakeJob)

      expect(created).toHaveLength(1)
      const { goal } = created[0]!
      // Next week: Mon Jun 22 – Sun Jun 28
      expect(goal.periodStart).toEqual(d('2026-06-22T00:00:00Z'))
      expect(goal.periodEnd).toEqual(d('2026-06-28T23:59:59.999Z'))
    })

    it('spawns week across month boundary correctly', async () => {
      const template = makeTemplate({
        id: goalId('template-weekly2'),
        recurrenceRule: { frequency: 'weekly' },
      })

      // Week of Mon Jun 29 – Sun Jul 5, 2026 (Jul 5 is Sunday)
      // Actually let me check: Jun 29 2026 is a Monday? Let's use a known week.
      // Jun 15, 2026 is a Monday. Jun 22 is Monday. Jun 29 is Monday.
      const weekInstance = makeInstance({
        id: goalId('instance-w-jun29'),
        parentGoalId: template.id,
        periodStart: d('2026-06-29T00:00:00Z'),
        periodEnd: d('2026-07-05T23:59:59Z'),
        recurrenceRule: { frequency: 'weekly' },
      })

      const { deps, created } = createFakeDeps({
        templates: [template],
        latestInstance: new Map([['template-weekly2', weekInstance]]),
        now: d('2026-07-06T00:00:00Z'), // Monday Jul 6
      })

      const handler = createSpawnRecurringInstancesHandler(deps)
      await handler(fakeJob)

      expect(created).toHaveLength(1)
      const { goal } = created[0]!
      // Next week: Mon Jul 6 – Sun Jul 12
      expect(goal.periodStart).toEqual(d('2026-07-06T00:00:00Z'))
      expect(goal.periodEnd).toEqual(d('2026-07-12T23:59:59.999Z'))
    })
  })

  // ── Edge cases ───────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('skips templates with no recurrenceRule', async () => {
      const template = makeTemplate({
        id: goalId('template-bad'),
        recurrenceRule: null,
      })

      const { deps, created } = createFakeDeps({
        templates: [template],
        latestInstance: new Map(),
        now: d('2026-06-01T00:00:00Z'),
      })

      const handler = createSpawnRecurringInstancesHandler(deps)
      const result = await handler(fakeJob)

      expect(result.spawned).toBe(0)
      expect(created).toHaveLength(0)
    })

    it('skips templates with no latest instance', async () => {
      const template = makeTemplate({ id: goalId('template-1') })

      const { deps, created } = createFakeDeps({
        templates: [template],
        latestInstance: new Map([['template-1', null]]),
        now: d('2026-06-01T00:00:00Z'),
      })

      const handler = createSpawnRecurringInstancesHandler(deps)
      const result = await handler(fakeJob)

      expect(result.spawned).toBe(0)
      expect(created).toHaveLength(0)
    })

    it('returns templatesChecked = 0 when no templates exist', async () => {
      const { deps } = createFakeDeps({
        templates: [],
        latestInstance: new Map(),
        now: d('2026-06-01T00:00:00Z'),
      })

      const handler = createSpawnRecurringInstancesHandler(deps)
      const result = await handler(fakeJob)

      expect(result.templatesChecked).toBe(0)
      expect(result.spawned).toBe(0)
    })
  })
})
