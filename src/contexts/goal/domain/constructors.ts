// Goal context — domain constructors
// Factory functions with full validation. Return Result (neverthrow).

import type {
  OrganizationId,
  PropertyId,
  PortalId,
  PortalGroupId,
  UserId,
  GoalId,
} from '#/shared/domain/ids'
import type { MetricKey, AggregationFunction } from '#/shared/domain/metric-keys'
import {
  isValidMetricKeyForScope,
  isValidAggregationForMetric,
} from '#/shared/domain/metric-keys'
import { assertNever } from '#/shared/domain/assert'
import type { Goal, GoalType, RecurrenceRule } from './types'
import { deriveEntityScope } from './types'
import { ok, err, type Result } from 'neverthrow'

// ── Error types ──────────────────────────────────────────────────────────

export type GoalConstructionError =
  | { tag: 'ambiguous_scope' }
  | { tag: 'invalid_metric_for_scope'; metricKey: MetricKey; scope: string }
  | {
      tag: 'invalid_aggregation_for_metric'
      metricKey: MetricKey
      aggregation: AggregationFunction
    }
  | { tag: 'period_not_allowed'; goalType: GoalType }
  | { tag: 'period_required'; goalType: GoalType }
  | { tag: 'invalid_period'; detail: string }
  | { tag: 'rolling_window_required' }
  | { tag: 'rolling_window_not_allowed'; goalType: GoalType }
  | { tag: 'recurrence_rule_required' }
  | { tag: 'recurrence_rule_not_allowed'; goalType: GoalType }
  | { tag: 'empty_name' }
  | { tag: 'name_too_long' }
  | { tag: 'description_too_long' }
  | { tag: 'invalid_target_value' }

// ── Input type ───────────────────────────────────────────────────────────

export type BuildGoalInput = Readonly<{
  id: GoalId
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  groupId: PortalGroupId | null
  name: string
  description: string | null
  createdBy: UserId
  goalType: GoalType
  aggregationFunction: AggregationFunction
  metricKey: MetricKey
  targetValue: number
  periodStart?: Date | null
  periodEnd?: Date | null
  recurrenceRule?: RecurrenceRule | null
  rollingWindowDays?: number | null
  parentGoalId?: GoalId | null
  now: Date
}>

// ── Constructor ──────────────────────────────────────────────────────────

export function buildGoal(input: BuildGoalInput): Result<Goal, GoalConstructionError> {
  const scope = deriveEntityScope(input)

  // Exactly-one FK validation
  const fkCount = [input.portalId, input.groupId].filter(Boolean).length
  if (fkCount > 1) {
    return err({ tag: 'ambiguous_scope' })
  }

  // Field validations
  if (!input.name.trim()) return err({ tag: 'empty_name' })
  if (input.name.length > 200) return err({ tag: 'name_too_long' })
  if (input.description !== null && input.description.length > 1000)
    return err({ tag: 'description_too_long' })
  if (!Number.isFinite(input.targetValue) || input.targetValue <= 0)
    return err({ tag: 'invalid_target_value' })

  // Scope → metric key
  if (!isValidMetricKeyForScope(scope, input.metricKey)) {
    return err({ tag: 'invalid_metric_for_scope', metricKey: input.metricKey, scope })
  }

  // Metric key → aggregation
  if (!isValidAggregationForMetric(input.metricKey, input.aggregationFunction)) {
    return err({
      tag: 'invalid_aggregation_for_metric',
      metricKey: input.metricKey,
      aggregation: input.aggregationFunction,
    })
  }

  const periodStart = input.periodStart ?? null
  const periodEnd = input.periodEnd ?? null
  const recurrenceRule = input.recurrenceRule ?? null
  const rollingWindowDays = input.rollingWindowDays ?? null

  // Goal type rules
  switch (input.goalType) {
    case 'open': {
      if (periodStart || periodEnd)
        return err({ tag: 'period_not_allowed', goalType: 'open' })
      if (rollingWindowDays !== null)
        return err({ tag: 'rolling_window_not_allowed', goalType: 'open' })
      if (recurrenceRule)
        return err({ tag: 'recurrence_rule_not_allowed', goalType: 'open' })
      break
    }
    case 'one_shot': {
      if (!periodStart || !periodEnd)
        return err({ tag: 'period_required', goalType: 'one_shot' })
      if (periodEnd <= periodStart)
        return err({
          tag: 'invalid_period',
          detail: 'periodEnd must be after periodStart',
        })
      if (rollingWindowDays !== null)
        return err({ tag: 'rolling_window_not_allowed', goalType: 'one_shot' })
      if (recurrenceRule)
        return err({ tag: 'recurrence_rule_not_allowed', goalType: 'one_shot' })
      break
    }
    case 'rolling': {
      if (!rollingWindowDays || rollingWindowDays <= 0)
        return err({ tag: 'rolling_window_required' })
      if (periodStart || periodEnd)
        return err({ tag: 'period_not_allowed', goalType: 'rolling' })
      if (recurrenceRule)
        return err({ tag: 'recurrence_rule_not_allowed', goalType: 'rolling' })
      break
    }
    case 'recurring': {
      if (!recurrenceRule) return err({ tag: 'recurrence_rule_required' })
      // Template (no parentGoalId) cannot have period dates;
      // Instances (parentGoalId set) must have period dates.
      const parentGoalId = input.parentGoalId ?? null
      if (!parentGoalId && (periodStart || periodEnd))
        return err({ tag: 'period_not_allowed', goalType: 'recurring' })
      if (parentGoalId) {
        if (!periodStart || !periodEnd)
          return err({ tag: 'period_required', goalType: 'recurring' })
        if (periodEnd <= periodStart)
          return err({
            tag: 'invalid_period',
            detail: 'periodEnd must be after periodStart',
          })
      }
      if (rollingWindowDays !== null)
        return err({ tag: 'rolling_window_not_allowed', goalType: 'recurring' })
      break
    }
    default: {
      assertNever('goalType', input.goalType)
    }
  }

  return ok({
    id: input.id,
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    portalId: input.portalId,
    groupId: input.groupId,
    name: input.name,
    description: input.description,
    createdBy: input.createdBy,
    goalType: input.goalType,
    aggregationFunction: input.aggregationFunction,
    metricKey: input.metricKey,
    targetValue: input.targetValue,
    status: 'active',
    periodStart,
    periodEnd,
    recurrenceRule,
    rollingWindowDays,
    parentGoalId: input.parentGoalId ?? null,
    completedAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  })
}
