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
import type { Goal, GoalType, RecurrenceRule } from './types'
import { deriveEntityScope } from './types'
import { ok, err, type Result } from '#/shared/domain'
import { goalError, type GoalError } from './errors'
import { firstGoalTypeRuleViolation, type GoalTemporalInput } from './goal-type-rules'

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

/** Normalize the optional temporal fields (undefined → null) for the rules + entity. */
function normalizeTemporalFields(input: BuildGoalInput): GoalTemporalInput {
  return {
    goalType: input.goalType,
    periodStart: input.periodStart ?? null,
    periodEnd: input.periodEnd ?? null,
    recurrenceRule: input.recurrenceRule ?? null,
    rollingWindowDays: input.rollingWindowDays ?? null,
    parentGoalId: input.parentGoalId ?? null,
  }
}

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

  // Goal type rules — the decision table (./goal-type-rules) owns the per-type
  // temporal validation (period × rolling window × recurrence rule × parent).
  const temporal = normalizeTemporalFields(input)
  const violation = firstGoalTypeRuleViolation(temporal)
  if (violation) {
    return err(violation)
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
    periodStart: temporal.periodStart,
    periodEnd: temporal.periodEnd,
    recurrenceRule: temporal.recurrenceRule,
    rollingWindowDays: temporal.rollingWindowDays,
    parentGoalId: temporal.parentGoalId,
    completedAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  })
}
