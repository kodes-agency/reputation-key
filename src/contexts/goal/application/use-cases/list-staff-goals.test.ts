// Goal context — list staff goals use case tests
// The staff visibility pipeline (assigned portals → portal groups → goals →
// visibility filter → progress batch) had no direct coverage. The only tests
// naming those steps lived in ../../server/staff-goals.test.ts and asserted
// against a mock container they had configured themselves, so no change to this
// file could ever fail them. These drive the real use case through injected
// fakes that are rebuilt per test, so nothing leaks between cases.

import { describe, it, expect, vi } from 'vitest'
import { listStaffGoals } from './list-staff-goals'
import { goalId, goalProgressId, organizationId } from '#/shared/domain/ids'
import { portalGroupId, portalId, propertyId, userId } from '#/shared/domain/ids'
import type { GoalListFilter, GoalRepository } from '../ports/goal.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { Goal, GoalProgress } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { GoalId, OrganizationId, PortalGroupId, PortalId } from '#/shared/domain/ids'

// ── Test fixtures ──────────────────────────────────────────────────────────

const ORG_ID = organizationId('org-001')
const PROP_ID = propertyId('prop-001')
const USER_ID = userId('user-001')
const ASSIGNED_PORTAL = portalId('portal-assigned')
const OTHER_PORTAL = portalId('portal-other')
const RESOLVED_GROUP = portalGroupId('group-resolved')
const OTHER_GROUP = portalGroupId('group-other')

const d = (iso: string) => new Date(iso)

const CTX = {
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'Staff',
} as AuthContext

const makeGoal = (overrides: { id: string } & Partial<Omit<Goal, 'id'>>): Goal => ({
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

// ── Ports the pipeline must not reach ──────────────────────────────────────
// Anything outside the five documented steps throws instead of quietly
// returning a plausible default.

const unsupported = (member: string) => (): never => {
  throw new Error(`${member} is not part of the listStaffGoals pipeline`)
}

const UNUSED_REPO_MEMBERS = {
  insert: unsupported('insert'),
  getById: unsupported('getById'),
  update: unsupported('update'),
  listInstances: unsupported('listInstances'),
  cancelByParent: unsupported('cancelByParent'),
  cancelTemplateAndInstances: unsupported('cancelTemplateAndInstances'),
  findAllActiveRecurring: unsupported('findAllActiveRecurring'),
  findAllActiveGlobal: unsupported('findAllActiveGlobal'),
  findActiveRecurringTemplates: unsupported('findActiveRecurringTemplates'),
  findLatestInstance: unsupported('findLatestInstance'),
  createGoalAndProgress: unsupported('createGoalAndProgress'),
  createRecurringGoalWithInstance: unsupported('createRecurringGoalWithInstance'),
  findActiveGoalsByMetric: unsupported('findActiveGoalsByMetric'),
  upsertProgress: unsupported('upsertProgress'),
  markGoalCompleted: unsupported('markGoalCompleted'),
  insertProgress: unsupported('insertProgress'),
  getProgress: unsupported('getProgress'),
  updateProgress: unsupported('updateProgress'),
  listInstancesBatch: unsupported('listInstancesBatch'),
}

// ── Setup helper ───────────────────────────────────────────────────────────

type SetupOptions = Readonly<{
  goals?: ReadonlyArray<Goal>
  progress?: Record<string, GoalProgress>
  assignedPortals?: ReadonlyArray<PortalId>
  groupIds?: ReadonlyArray<PortalGroupId>
}>

const setup = (options?: SetupOptions) => {
  const goals = options?.goals ?? []
  const progress = options?.progress ?? {}

  const list = vi.fn(
    async (filter: GoalListFilter): Promise<ReadonlyArray<Goal>> =>
      goals.filter(
        (goal) =>
          goal.organizationId === filter.organizationId &&
          goal.propertyId === filter.propertyId,
      ),
  )

  const getProgressBatch = vi.fn(
    async (
      goalIds: readonly GoalId[],
      _orgId: OrganizationId,
    ): Promise<ReadonlyMap<GoalId, GoalProgress | null>> => {
      const map = new Map<GoalId, GoalProgress | null>()
      for (const id of goalIds) map.set(id, progress[id as string] ?? null)
      return map
    },
  )

  const getAssignedPortals = vi.fn(
    async (): Promise<ReadonlyArray<PortalId>> => options?.assignedPortals ?? [],
  )

  const findGroupIdsByPortalIds = vi.fn(
    async (): Promise<ReadonlyArray<PortalGroupId>> => options?.groupIds ?? [],
  )

  const goalRepo: GoalRepository = { ...UNUSED_REPO_MEMBERS, list, getProgressBatch }
  const staffPublicApi: StaffPublicApi = {
    getAccessiblePropertyIds: unsupported('getAccessiblePropertyIds'),
    getAssignedPortals,
    countAssignmentsByTeam: unsupported('countAssignmentsByTeam'),
  }

  const useCase = listStaffGoals({
    goalRepo,
    staffPublicApi,
    portalGroupLookup: { findGroupIdsByPortalIds },
  })

  return { useCase, list, getProgressBatch, getAssignedPortals, findGroupIdsByPortalIds }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('listStaffGoals', () => {
  it('returns nothing and touches no port when no property is selected', async () => {
    const { useCase, getAssignedPortals, list } = setup({
      goals: [makeGoal({ id: 'g-portal', portalId: ASSIGNED_PORTAL })],
      assignedPortals: [ASSIGNED_PORTAL],
    })

    expect(await useCase({}, CTX)).toEqual([])
    expect(getAssignedPortals).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
  })

  it('resolves assigned portals for the calling user and the requested property', async () => {
    const { useCase, getAssignedPortals } = setup({
      assignedPortals: [ASSIGNED_PORTAL],
    })

    await useCase({ propertyId: PROP_ID }, CTX)

    expect(getAssignedPortals).toHaveBeenCalledWith(
      { userId: USER_ID, propertyId: PROP_ID },
      CTX,
    )
  })

  it('skips the portal-group lookup when no portals are assigned', async () => {
    const { useCase, findGroupIdsByPortalIds } = setup({
      goals: [makeGoal({ id: 'g-group', portalGroupId: RESOLVED_GROUP })],
      groupIds: [RESOLVED_GROUP],
      assignedPortals: [],
    })

    expect(await useCase({ propertyId: PROP_ID }, CTX)).toEqual([])
    expect(findGroupIdsByPortalIds).not.toHaveBeenCalled()
  })

  it('resolves portal groups from the assigned portal IDs', async () => {
    const { useCase, findGroupIdsByPortalIds } = setup({
      assignedPortals: [ASSIGNED_PORTAL, OTHER_PORTAL],
      groupIds: [RESOLVED_GROUP],
    })

    await useCase({ propertyId: PROP_ID }, CTX)

    expect(findGroupIdsByPortalIds).toHaveBeenCalledWith(ORG_ID, [
      ASSIGNED_PORTAL,
      OTHER_PORTAL,
    ])
  })

  it('queries goals for the caller organization and the requested property', async () => {
    const { useCase, list } = setup({ assignedPortals: [ASSIGNED_PORTAL] })

    await useCase({ propertyId: PROP_ID }, CTX)

    expect(list).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
    })
  })

  it('returns goals scoped to an assigned portal or a resolved portal group', async () => {
    const { useCase } = setup({
      goals: [
        makeGoal({ id: 'g-portal', portalId: ASSIGNED_PORTAL }),
        makeGoal({ id: 'g-group', portalGroupId: RESOLVED_GROUP }),
      ],
      assignedPortals: [ASSIGNED_PORTAL],
      groupIds: [RESOLVED_GROUP],
    })

    const result = await useCase({ propertyId: PROP_ID }, CTX)

    expect(result.map((entry) => entry.goal.id as string)).toEqual([
      'g-portal',
      'g-group',
    ])
  })

  it('hides unassigned portals, unresolved groups and property-wide goals', async () => {
    const { useCase } = setup({
      goals: [
        makeGoal({ id: 'g-mine', portalId: ASSIGNED_PORTAL }),
        makeGoal({ id: 'g-other-portal', portalId: OTHER_PORTAL }),
        makeGoal({ id: 'g-other-group', portalGroupId: OTHER_GROUP }),
        makeGoal({ id: 'g-property-wide' }),
      ],
      assignedPortals: [ASSIGNED_PORTAL],
      groupIds: [RESOLVED_GROUP],
    })

    const result = await useCase({ propertyId: PROP_ID }, CTX)

    expect(result.map((entry) => entry.goal.id as string)).toEqual(['g-mine'])
  })

  it('batches progress for the visible goals and reports null when a goal has none', async () => {
    const { useCase, getProgressBatch } = setup({
      goals: [
        makeGoal({ id: 'g-with', portalId: ASSIGNED_PORTAL }),
        makeGoal({ id: 'g-without', portalId: ASSIGNED_PORTAL }),
      ],
      progress: { 'g-with': makeProgress('g-with', { currentValue: 25 }) },
      assignedPortals: [ASSIGNED_PORTAL],
    })

    const result = await useCase({ propertyId: PROP_ID }, CTX)

    expect(getProgressBatch).toHaveBeenCalledWith(['g-with', 'g-without'], ORG_ID)
    expect(result[0].progress?.currentValue).toBe(25)
    expect(result[1].progress).toBeNull()
  })

  it('skips the progress batch when no goal is visible', async () => {
    const { useCase, getProgressBatch } = setup({
      goals: [makeGoal({ id: 'g-property-wide' })],
      assignedPortals: [ASSIGNED_PORTAL],
    })

    expect(await useCase({ propertyId: PROP_ID }, CTX)).toEqual([])
    expect(getProgressBatch).not.toHaveBeenCalled()
  })
})
