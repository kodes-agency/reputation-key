// Goal context — domain events

import type {
  GoalId,
  OrganizationId,
  PropertyId,
  PortalId,
  TeamId,
  StaffId,
  UserId,
} from '#/shared/domain/ids'
import type { MetricKey, AggregationFunction } from '#/shared/domain/metric-keys'
import type { GoalType, ComputedSource } from './types'

// fallow-ignore-next-line unused-type
export type GoalCompleted = Readonly<{
  _tag: 'goal.completed'
  goalId: GoalId
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  teamId: TeamId | null
  staffId: StaffId | null
  goalType: GoalType
  aggregationFunction: AggregationFunction
  metricKey: MetricKey
  targetValue: number
  completedValue: number
  completedAt: Date
  parentGoalId: GoalId | null
  createdBy: UserId
}>

// fallow-ignore-next-line unused-type
export type GoalProgressUpdated = Readonly<{
  _tag: 'goal.progress_updated'
  goalId: GoalId
  organizationId: OrganizationId
  metricKey: MetricKey
  previousValue: number
  currentValue: number
  computedSource: ComputedSource
  occurredAt: Date
}>

export type GoalEvent = GoalCompleted | GoalProgressUpdated

export const goalCompleted = (args: Omit<GoalCompleted, '_tag'>): GoalCompleted => ({
  _tag: 'goal.completed',
  ...args,
})

export const goalProgressUpdated = (
  args: Omit<GoalProgressUpdated, '_tag'>,
): GoalProgressUpdated => ({
  _tag: 'goal.progress_updated',
  ...args,
})
