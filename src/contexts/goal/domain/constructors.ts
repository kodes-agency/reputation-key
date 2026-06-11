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
import { goalError, type GoalError } from './errors'

// ── Input type ───────────────────────────────────────────────────────────

export type BuildGoalInput = Readonly<{
  id: GoalId
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  portalGroupId: PortalGroupId | null
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

export function buildGoal(input: BuildGoalInput): Result<Goal, GoalError> {
  const scope = deriveEntityScope(input)

  // Exactly-one FK validation
  const fkCount = [input.portalId, input.portalGroupId].filter(Boolean).length
  if (fkCount > 1) {
    return err(goalError('ambiguous_scope', 'Ambiguous scope: multiple FKs provided'))
  }

  // Field validations
  if (!input.name.trim()) return err(goalError('empty_name', 'Goal name cannot be empty'))
  if (input.name.length > 200)
    return err(goalError('name_too_long', 'Goal name exceeds 200 characters'))
  if (input.description !== null && input.description.length > 1000)
    return err(
      goalError('description_too_long', 'Goal description exceeds 1000 characters'),
    )
  if (!Number.isFinite(input.targetValue) || input.targetValue <= 0)
    return err(
      goalError('invalid_target_value', 'Target value must be a positive finite number'),
    )

  // Scope → metric key
  if (!isValidMetricKeyForScope(scope, input.metricKey)) {
    return err(
      goalError(
        'invalid_metric_for_scope',
        `Metric key ${input.metricKey} not valid for scope ${scope}`,
        { metricKey: input.metricKey, scope },
      ),
    )
  }

  // Metric key → aggregation
  if (!isValidAggregationForMetric(input.metricKey, input.aggregationFunction)) {
    return err(
      goalError(
        'invalid_aggregation_for_metric',
        `Aggregation ${input.aggregationFunction} not valid for metric ${input.metricKey}`,
        { metricKey: input.metricKey, aggregation: input.aggregationFunction },
      ),
    )
  }

  const periodStart = input.periodStart ?? null
  const periodEnd = input.periodEnd ?? null
  const recurrenceRule = input.recurrenceRule ?? null
  const rollingWindowDays = input.rollingWindowDays ?? null

  // Goal type rules
  switch (input.goalType) {
    case 'open': {
      if (periodStart || periodEnd)
        return err(
          goalError('period_not_allowed', 'Period not allowed for open goals', {
            goalType: 'open',
          }),
        )
      if (rollingWindowDays !== null)
        return err(
          goalError(
            'rolling_window_not_allowed',
            'Rolling window not allowed for open goals',
            { goalType: 'open' },
          ),
        )
      if (recurrenceRule)
        return err(
          goalError(
            'recurrence_rule_not_allowed',
            'Recurrence rule not allowed for open goals',
            { goalType: 'open' },
          ),
        )
      break
    }
    case 'one_shot': {
      if (!periodStart || !periodEnd)
        return err(
          goalError('period_required', 'Period required for one-shot goals', {
            goalType: 'one_shot',
          }),
        )
      if (periodEnd <= periodStart)
        return err(goalError('invalid_period', 'periodEnd must be after periodStart'))
      if (rollingWindowDays !== null)
        return err(
          goalError(
            'rolling_window_not_allowed',
            'Rolling window not allowed for one-shot goals',
            { goalType: 'one_shot' },
          ),
        )
      if (recurrenceRule)
        return err(
          goalError(
            'recurrence_rule_not_allowed',
            'Recurrence rule not allowed for one-shot goals',
            { goalType: 'one_shot' },
          ),
        )
      break
    }
    case 'rolling': {
      if (!rollingWindowDays || rollingWindowDays <= 0)
        return err(
          goalError(
            'rolling_window_required',
            'Rolling window required for rolling goals',
          ),
        )
      if (periodStart || periodEnd)
        return err(
          goalError('period_not_allowed', 'Period not allowed for rolling goals', {
            goalType: 'rolling',
          }),
        )
      if (recurrenceRule)
        return err(
          goalError(
            'recurrence_rule_not_allowed',
            'Recurrence rule not allowed for rolling goals',
            { goalType: 'rolling' },
          ),
        )
      break
    }
    case 'recurring': {
      if (!recurrenceRule)
        return err(
          goalError(
            'recurrence_rule_required',
            'Recurrence rule required for recurring goals',
          ),
        )
      // Template (no parentGoalId) cannot have period dates;
      // Instances (parentGoalId set) must have period dates.
      const parentGoalId = input.parentGoalId ?? null
      if (!parentGoalId && (periodStart || periodEnd))
        return err(
          goalError('period_not_allowed', 'Period not allowed for recurring templates', {
            goalType: 'recurring',
          }),
        )
      if (parentGoalId) {
        if (!periodStart || !periodEnd)
          return err(
            goalError('period_required', 'Period required for recurring instances', {
              goalType: 'recurring',
            }),
          )
        if (periodEnd <= periodStart)
          return err(goalError('invalid_period', 'periodEnd must be after periodStart'))
      }
      if (rollingWindowDays !== null)
        return err(
          goalError(
            'rolling_window_not_allowed',
            'Rolling window not allowed for recurring goals',
            { goalType: 'recurring' },
          ),
        )
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
    portalGroupId: input.portalGroupId,
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
