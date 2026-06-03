// Goal context — domain events
// Standards: docs/standards.md §1

import type {
  GoalId,
  OrganizationId,
  PropertyId,
  PortalId,
  PortalGroupId,
  UserId,
} from '#/shared/domain/ids'
import type { MetricKey, AggregationFunction } from '#/shared/domain/metric-keys'
import type { GoalType, ComputedSource } from './types'

export type GoalCompleted = Readonly<{
  _tag: 'goal.completed'
  eventId: string
  goalId: GoalId
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  groupId: PortalGroupId | null
  goalType: GoalType
  aggregationFunction: AggregationFunction
  metricKey: MetricKey
  targetValue: number
  completedValue: number
  completedAt: Date
  parentGoalId: GoalId | null
  createdBy: UserId
  occurredAt: Date
  correlationId: string | null
}>
export const goalCompleted = (
  args: Omit<GoalCompleted, '_tag' | 'eventId' | 'correlationId'>,
): GoalCompleted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'goal.completed',
    eventId: crypto.randomUUID(),
    correlationId: null,
    ...args,
  }
}

export type GoalProgressUpdated = Readonly<{
  _tag: 'goal.progress_updated'
  eventId: string
  goalId: GoalId
  organizationId: OrganizationId
  metricKey: MetricKey
  previousValue: number
  currentValue: number
  computedSource: ComputedSource
  occurredAt: Date
  correlationId: string | null
}>
export const goalProgressUpdated = (
  args: Omit<GoalProgressUpdated, '_tag' | 'eventId' | 'correlationId'>,
): GoalProgressUpdated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'goal.progress_updated',
    eventId: crypto.randomUUID(),
    correlationId: null,
    ...args,
  }
}

export type GoalEvent = GoalCompleted | GoalProgressUpdated
