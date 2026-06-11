// Goal context — domain events

import assert from 'node:assert/strict'
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

// fallow-ignore-next-line unused-type
export type GoalProgressUpdated = Readonly<{
  _tag: 'goal.progress_updated'
  eventId: string
  correlationId: string | null
  goalId: GoalId
  organizationId: OrganizationId
  metricKey: MetricKey
  previousValue: number
  currentValue: number
  computedSource: ComputedSource
  occurredAt: Date
}>

export type GoalEvent = GoalCompleted | GoalProgressUpdated

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

export const goalProgressUpdated = (
  args: Omit<GoalProgressUpdated, '_tag' | 'eventId' | 'correlationId'>,
): GoalProgressUpdated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  if (typeof args.previousValue !== 'number' || isNaN(args.previousValue)) {
    throw goalError('validation_error', 'previousValue must be a valid number')
  }
  if (typeof args.currentValue !== 'number' || isNaN(args.currentValue)) {
    throw goalError('validation_error', 'currentValue must be a valid number')
  }
  return {
    _tag: 'goal.progress_updated',
    eventId: crypto.randomUUID(),
    correlationId: null,
    ...args,
  }
}
