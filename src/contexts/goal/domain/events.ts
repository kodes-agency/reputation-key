// Goal context — domain events

import { assert } from '#/shared/domain/assert'
import type {
  GoalId,
  OrganizationId,
  PropertyId,
  PortalId,
  PortalGroupId,
  UserId,
} from '#/shared/domain/ids'
import type { MetricKey, AggregationFunction } from '#/shared/domain/metric-keys'
import type { GoalType } from './types'
import { goalError } from './errors'

// fallow-ignore-next-line unused-type
export type GoalCompleted = Readonly<{
  _tag: 'goal.completed'
  eventId: string
  correlationId: string | null
  goalId: GoalId
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  portalGroupId: PortalGroupId | null
  goalType: GoalType
  aggregationFunction: AggregationFunction
  metricKey: MetricKey
  targetValue: number
  completedValue: number
  completedAt: Date
  parentGoalId: GoalId | null
  createdBy: UserId
}>

export type GoalEvent = GoalCompleted

export const goalCompleted = (
  args: Omit<GoalCompleted, '_tag' | 'eventId' | 'correlationId'>,
): GoalCompleted => {
  assert(args.completedAt instanceof Date, 'completedAt must be Date')
  if (typeof args.targetValue !== 'number' || isNaN(args.targetValue)) {
    throw goalError('validation_error', 'targetValue must be a valid number')
  }
  if (typeof args.completedValue !== 'number' || isNaN(args.completedValue)) {
    throw goalError('validation_error', 'completedValue must be a valid number')
  }
  return {
    _tag: 'goal.completed',
    eventId: crypto.randomUUID(),
    correlationId: null,
    ...args,
  }
}
