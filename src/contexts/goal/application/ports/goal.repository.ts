// Goal context — goal repository port
// Per architecture: "Repository ports for all data access."

import type {
  Goal,
  GoalProgress,
  GoalStatus,
  GoalType,
  RecurrenceRule,
  ComputedSource,
} from '../../domain/types'
import type {
  GoalId,
  OrganizationId,
  PortalGroupId,
  PropertyId,
  PortalId,
} from '#/shared/domain/ids'
import type { MetricKey, AggregationFunction } from '#/shared/domain/metric-keys'

export type GoalListFilter = Readonly<{
  organizationId: OrganizationId
  propertyId?: PropertyId
  portalId?: PortalId
  groupId?: PortalGroupId
  status?: GoalStatus
  goalType?: GoalType
}>

export type GoalRepository = Readonly<{
  // ── Goal CRUD ──────────────────────────────────────────────────────────
  insert(goal: Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>): Promise<Goal>
  getById(id: GoalId, orgId: OrganizationId): Promise<Goal | null>
  update(
    id: GoalId,
    orgId: OrganizationId,
    data: Readonly<{
      targetValue?: number
      status?: GoalStatus
      completedAt?: Date | null
      recurrenceRule?: RecurrenceRule | null
      updatedAt: Date
    }>,
  ): Promise<Goal | null>
  list(filter: GoalListFilter): Promise<ReadonlyArray<Goal>>
  listInstances(parentGoalId: GoalId, orgId: OrganizationId): Promise<ReadonlyArray<Goal>>
  cancelByParent(parentGoalId: GoalId, orgId: OrganizationId, now: Date): Promise<number>

  // ── Goal queries (reconciliation & spawner) ───────────────────────────
  // Safe: findAllActive is a background job that legitimately processes all orgs
  findAllActive(): Promise<ReadonlyArray<Goal>>
  findActiveRecurringTemplates(
    organizationId: OrganizationId,
  ): Promise<ReadonlyArray<Goal>>
  findLatestInstance(parentGoalId: GoalId, orgId: OrganizationId): Promise<Goal | null>
  createGoalAndProgress(goal: Goal, progress: GoalProgress): Promise<void>

  // ── Event-driven increment ───────────────────────────────────────────
  findActiveGoalsByMetric(
    metricKey: MetricKey,
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId | null,
    groupId: PortalGroupId | null,
  ): Promise<ReadonlyArray<Goal>>

  incrementProgress(
    goalId: GoalId,
    aggregation: AggregationFunction,
    delta: number,
  ): Promise<{
    currentValue: number
    currentSum: number | null
    currentCount: number | null
  }>

  // Upsert progress — inserts if no row exists, increments otherwise.
  // Used by event-driven handler (onMetricRecorded) where initial row
  // may not exist yet for newly created goals.
  upsertProgress(
    goalId: GoalId,
    organizationId: OrganizationId,
    aggregation: AggregationFunction,
    delta: number,
  ): Promise<{
    currentValue: number
    currentSum: number | null
    currentCount: number | null
  }>

  markGoalCompleted(
    goalId: GoalId,
    organizationId: OrganizationId,
    completedAt: Date,
  ): Promise<void>

  // ── Goal Progress ──────────────────────────────────────────────────────
  insertProgress(progress: Omit<GoalProgress, 'id'>): Promise<GoalProgress>
  // Safe: goalId is a globally unique UUID — no cross-tenant risk
  getProgress(goalId: GoalId): Promise<GoalProgress | null>
  // Batch: fetches progress for multiple goals in a single query
  getProgressBatch(
    goalIds: readonly GoalId[],
  ): Promise<ReadonlyMap<GoalId, GoalProgress | null>>
  // Safe: goalId is a globally unique UUID — no cross-tenant risk
  updateProgress(
    goalId: GoalId,
    data: Readonly<{
      currentValue: number
      currentSum?: number | null
      currentCount?: number | null
      lastComputedAt: Date
      computedSource: ComputedSource
    }>,
  ): Promise<GoalProgress | null>

  // ── Batch lookups (N+1 elimination) ──────────────────────────────────
  listInstancesBatch(
    parentGoalIds: readonly GoalId[],
    orgId: OrganizationId,
  ): Promise<ReadonlyMap<GoalId, Goal[]>>

  // ── Staff goal resolution ────────────────────────────────────────────
  // Query goals where portalId IN (portalIds) OR groupId IN (groupIds)
  // OR (portalId IS NULL AND groupId IS NULL) for property-scoped goals.
  // Used by listStaffGoals to resolve goals for a staff member's assigned portals.
  listByPortalAndGroupIds(input: {
    organizationId: OrganizationId
    portalIds: ReadonlyArray<PortalId>
    groupIds: ReadonlyArray<PortalGroupId>
    includePropertyScoped?: boolean
  }): Promise<ReadonlyArray<Goal>>
}>
