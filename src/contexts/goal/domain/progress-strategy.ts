// Goal context — progress strategy
// Translates a Goal into a structured ProgressQuery describing what to compute,
// and computes the final numeric progress value from raw metric readings.

import type { AggregationFunction, MetricKey } from '#/shared/domain/metric-keys'
import type { PropertyId, PortalId, TeamId, StaffId } from '#/shared/domain/ids'
import type { Goal } from './types'
import { err, ok, type Result } from 'neverthrow'

// ── Types ────────────────────────────────────────────────────────────────

export type TimeFilter =
  | Readonly<{ tag: 'none' }>
  | Readonly<{ tag: 'bounded'; start: Date; end: Date }>
  | Readonly<{ tag: 'sliding_window'; days: number }>

export type ProgressQuery = Readonly<{
  aggregateFunction: AggregationFunction
  timeFilter: TimeFilter
  metricKey: MetricKey
  scopeFilter: {
    propertyId: PropertyId
    portalId: PortalId | null
    teamId: TeamId | null
    staffId: StaffId | null
  }
}>

// ── Errors ───────────────────────────────────────────────────────────────

export type ProgressQueryError =
  | { tag: 'recurring_template_without_instance_period' }
  | { tag: 'non_recurring_goal' }
  | { tag: 'rolling_window_missing' }

// ── buildProgressQuery ───────────────────────────────────────────────────

/**
 * Build a ProgressQuery from a Goal.
 *
 * Recurring templates (goalType='recurring') have null periodStart/periodEnd.
 * A recurring *instance* would have its own periodStart/periodEnd set by the
 * scheduler. If you call this on a template, you must supply an instance
 * override — otherwise we return an error.
 */
export function buildProgressQuery(
  goal: Goal,
): Result<ProgressQuery, ProgressQueryError> {
  const timeFilterResult = resolveTimeFilter(goal)
  if (timeFilterResult.isErr()) return err(timeFilterResult.error)

  return ok({
    aggregateFunction: goal.aggregationFunction,
    timeFilter: timeFilterResult.value,
    metricKey: goal.metricKey,
    scopeFilter: {
      propertyId: goal.propertyId,
      portalId: goal.portalId,
      teamId: goal.teamId,
      staffId: goal.staffId,
    },
  })
}

/**
 * Overload for recurring instances: pass the template Goal plus explicit
 * instance period dates. Returns error if used on a non-recurring goal.
 */
export function buildProgressQueryForInstance(
  goal: Goal,
  instancePeriodStart: Date,
  instancePeriodEnd: Date,
): Result<ProgressQuery, ProgressQueryError> {
  if (goal.goalType !== 'recurring') {
    return err({ tag: 'non_recurring_goal' })
  }

  return ok({
    aggregateFunction: goal.aggregationFunction,
    timeFilter: { tag: 'bounded', start: instancePeriodStart, end: instancePeriodEnd },
    metricKey: goal.metricKey,
    scopeFilter: {
      propertyId: goal.propertyId,
      portalId: goal.portalId,
      teamId: goal.teamId,
      staffId: goal.staffId,
    },
  })
}

// ── Internal ─────────────────────────────────────────────────────────────

function resolveTimeFilter(goal: Goal): Result<TimeFilter, ProgressQueryError> {
  switch (goal.goalType) {
    case 'open':
      return ok({ tag: 'none' })

    case 'one_shot': {
      // Constructor guarantees periodStart/periodEnd for one_shot
      return ok({
        tag: 'bounded',
        start: goal.periodStart!,
        end: goal.periodEnd!,
      })
    }

    case 'rolling': {
      // Constructor guarantees rollingWindowDays for rolling
      return ok({ tag: 'sliding_window', days: goal.rollingWindowDays! })
    }

    case 'recurring': {
      // Template has null periods — recurring instances get bounded from scheduler.
      // If periodStart/periodEnd happen to be set (instance), use them.
      if (goal.periodStart && goal.periodEnd) {
        return ok({ tag: 'bounded', start: goal.periodStart, end: goal.periodEnd })
      }
      // Template without instance period — return error. Caller should use
      // buildProgressQueryForInstance or pass an instance goal.
      return err({ tag: 'recurring_template_without_instance_period' })
    }

    default: {
      const _exhaustive: never = goal.goalType
      throw new Error(`Unhandled goal type: ${_exhaustive}`)
    }
  }
}

// ── computeProgressValue ─────────────────────────────────────────────────

/**
 * Compute the progress value from raw metric reading rows.
 *
 * For AVG we compute sum/count manually (not SQL AVG), because the
 * goal_progress table stores currentSum and currentCount separately.
 */
export function computeProgressValue(
  agg: AggregationFunction,
  rows: ReadonlyArray<{ value: number }>,
): number {
  if (rows.length === 0) return 0

  switch (agg) {
    case 'sum':
      return rows.reduce((acc, r) => acc + r.value, 0)

    case 'count':
      return rows.length

    case 'max':
      return Math.max(...rows.map((r) => r.value))

    case 'avg': {
      const sum = rows.reduce((acc, r) => acc + r.value, 0)
      return sum / rows.length
    }
    default: {
      const _exhaustive: never = agg
      throw new Error(`Unhandled aggregation: ${_exhaustive}`)
    }
  }
}
