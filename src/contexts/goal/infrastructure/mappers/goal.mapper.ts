// Goal context — row → domain mappers for goals & goal_progress
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { goals, goalProgress } from '#/shared/db/schema/goal.schema'
import type {
  Goal,
  GoalProgress,
  GoalType,
  GoalStatus,
  RecurrenceFrequency,
  ComputedSource,
} from '../../domain/types'
import type { MetricKey, AggregationFunction } from '#/shared/domain/metric-keys'
import {
  goalId,
  goalProgressId,
  organizationId,
  propertyId,
  portalId,
  portalGroupId,
  userId,
} from '#/shared/domain/ids'

type GoalRow = typeof goals.$inferSelect
type GoalProgressRow = typeof goalProgress.$inferSelect

const VALID_GOAL_TYPES: readonly GoalType[] = ['open', 'one_shot', 'rolling', 'recurring']
const VALID_STATUSES: readonly GoalStatus[] = [
  'active',
  'completed',
  'expired',
  'cancelled',
]
const VALID_AGGREGATIONS: readonly AggregationFunction[] = ['sum', 'count', 'max', 'avg']
const VALID_METRIC_KEYS: readonly MetricKey[] = [
  'portal.scan',
  'portal.rating',
  'portal.feedback',
  'portal.review_link_click',
  'property.review',
]
const VALID_COMPUTED_SOURCES: readonly ComputedSource[] = [
  'event_increment',
  'reconciliation',
]

function assertLiteral<T extends string>(
  value: string,
  valid: readonly T[],
  label: string,
): T {
  if (!valid.includes(value as T)) {
    throw new Error(`Invalid ${label}: ${value}`)
  }
  return value as T
}

export const goalFromRow = (row: GoalRow): Goal => ({
  id: goalId(row.id),
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  portalId: row.portalId ? portalId(row.portalId) : null,
  groupId: row.groupId ? portalGroupId(row.groupId) : null,
  name: row.name,
  description: row.description,
  createdBy: userId(row.createdBy),
  goalType: assertLiteral(row.goalType, VALID_GOAL_TYPES, 'goalType'),
  aggregationFunction: assertLiteral(
    row.aggregationFunction,
    VALID_AGGREGATIONS,
    'aggregationFunction',
  ),
  metricKey: assertLiteral(row.metricKey, VALID_METRIC_KEYS, 'metricKey'),
  targetValue: row.targetValue,
  status: assertLiteral(row.status, VALID_STATUSES, 'status'),
  periodStart: row.periodStart,
  periodEnd: row.periodEnd,
  recurrenceRule: row.recurrenceRule
    ? {
        frequency: assertLiteral(
          row.recurrenceRule.frequency,
          ['weekly', 'monthly', 'quarterly'],
          'recurrenceFrequency',
        ) as RecurrenceFrequency,
      }
    : null,
  rollingWindowDays: row.rollingWindowDays,
  parentGoalId: row.parentGoalId ? goalId(row.parentGoalId) : null,
  completedAt: row.completedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const goalProgressFromRow = (row: GoalProgressRow): GoalProgress => ({
  id: goalProgressId(row.id),
  goalId: goalId(row.goalId),
  currentValue: row.currentValue,
  currentSum: row.currentSum,
  currentCount: row.currentCount,
  lastComputedAt: row.lastComputedAt,
  computedSource: assertLiteral(
    row.computedSource,
    VALID_COMPUTED_SOURCES,
    'computedSource',
  ),
})

/**
 * Convert a domain Goal (without id/createdAt/updatedAt) to a Drizzle insert row.
 */
export const goalToInsertRow = (
  goal: Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>,
): typeof goals.$inferInsert => ({
  organizationId: goal.organizationId as string,
  propertyId: goal.propertyId as string,
  portalId: goal.portalId as string | null,
  groupId: goal.groupId as string | null,
  name: goal.name,
  description: goal.description,
  createdBy: goal.createdBy as string,
  goalType: goal.goalType,
  aggregationFunction: goal.aggregationFunction,
  metricKey: goal.metricKey,
  targetValue: goal.targetValue,
  status: goal.status,
  periodStart: goal.periodStart,
  periodEnd: goal.periodEnd,
  recurrenceRule: goal.recurrenceRule
    ? { frequency: goal.recurrenceRule.frequency }
    : null,
  rollingWindowDays: goal.rollingWindowDays,
  parentGoalId: goal.parentGoalId as string | null,
  completedAt: goal.completedAt,
})

/**
 * Convert domain GoalProgress (without id) to a Drizzle insert row.
 */
export const goalProgressToInsertRow = (
  progress: Omit<GoalProgress, 'id'>,
): typeof goalProgress.$inferInsert => ({
  goalId: progress.goalId as string,
  currentValue: progress.currentValue,
  currentSum: progress.currentSum,
  currentCount: progress.currentCount,
  lastComputedAt: progress.lastComputedAt,
  computedSource: progress.computedSource,
})
