// Goal context — domain types
// Per architecture: readonly branded types, no business logic (constructors handle that).

import type {
  OrganizationId,
  PropertyId,
  PortalId,
  TeamId,
  StaffId,
  UserId,
  GoalId,
  GoalProgressId,
} from '#/shared/domain/ids'
import type {
  MetricKey,
  AggregationFunction,
  EntityScope,
} from '#/shared/domain/metric-keys'

// ── Enums ────────────────────────────────────────────────────────────────

export type GoalType = 'open' | 'one_shot' | 'rolling' | 'recurring'
export type GoalStatus = 'active' | 'completed' | 'expired' | 'cancelled'
export type RecurrenceFrequency = 'weekly' | 'monthly' | 'quarterly'
export type RecurrenceRule = Readonly<{ frequency: RecurrenceFrequency }>
export type ComputedSource = 'event_increment' | 'reconciliation'

// ── Goal ─────────────────────────────────────────────────────────────────

export type Goal = Readonly<{
  id: GoalId
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  teamId: TeamId | null
  staffId: StaffId | null
  name: string
  description: string | null
  createdBy: UserId
  goalType: GoalType
  aggregationFunction: AggregationFunction
  metricKey: MetricKey
  targetValue: number
  status: GoalStatus
  periodStart: Date | null
  periodEnd: Date | null
  recurrenceRule: RecurrenceRule | null
  rollingWindowDays: number | null
  parentGoalId: GoalId | null
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
}>

// ── Goal Progress ────────────────────────────────────────────────────────

export type GoalProgress = Readonly<{
  id: GoalProgressId
  goalId: GoalId
  currentValue: number
  currentSum: number | null
  currentCount: number | null
  lastComputedAt: Date
  computedSource: ComputedSource
}>

// ── Entity Scope Input ───────────────────────────────────────────────────
// Used in create goal input to specify which entity the goal targets.

export type GoalScopeInput = Readonly<{
  propertyId: PropertyId
  portalId: PortalId | null
  teamId: TeamId | null
  staffId: StaffId | null
}>

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Derive the EntityScope from a Goal's filled nullable FKs.
 * Exactly one of [portalId, teamId, staffId] determines the scope.
 * If all are null, scope is 'property'.
 */
export function deriveEntityScope(goal: {
  portalId: PortalId | null
  teamId: TeamId | null
  staffId: StaffId | null
}): EntityScope {
  if (goal.staffId) return 'staff'
  if (goal.teamId) return 'team'
  if (goal.portalId) return 'portal'
  return 'property'
}
