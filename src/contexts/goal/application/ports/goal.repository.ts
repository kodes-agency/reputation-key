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
  PropertyId,
  PortalId,
  TeamId,
  StaffId,
} from '#/shared/domain/ids'

export type GoalListFilter = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId?: PortalId
  teamId?: TeamId
  staffId?: StaffId
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
      recurrenceRule?: RecurrenceRule | null
      updatedAt: Date
    }>,
  ): Promise<Goal | null>
  list(filter: GoalListFilter): Promise<ReadonlyArray<Goal>>
  listInstances(parentGoalId: GoalId, orgId: OrganizationId): Promise<ReadonlyArray<Goal>>
  cancelByParent(parentGoalId: GoalId, orgId: OrganizationId, now: Date): Promise<number>

  // ── Goal Progress ──────────────────────────────────────────────────────
  insertProgress(progress: Omit<GoalProgress, 'id'>): Promise<GoalProgress>
  getProgress(goalId: GoalId): Promise<GoalProgress | null>
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
}>
