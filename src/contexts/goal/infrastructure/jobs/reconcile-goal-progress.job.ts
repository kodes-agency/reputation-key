// Goal context — reconcile-goal-progress job
// Recomputes progress for all active goals from metric_readings aggregates,
// then expires or completes goals whose periods have ended.

import type { Job } from 'bullmq'
import type { GoalRepository } from '../../application/ports/goal.repository'
import type {
  MetricReadingsQuery,
  MetricReadingsAggregate,
} from '#/contexts/metric/application/public-api'
import type { MetricPublicApi } from '#/contexts/metric/application/public-api'
import type { EventBus } from '#/shared/events/event-bus'
import type { AggregationFunction } from '#/shared/domain/metric-keys'
import { buildProgressQuery, type ProgressQuery } from '../../domain/progress-strategy'
import type { Goal } from '../../domain/types'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

// ── Job name ──────────────────────────────────────────────────────────────

export const RECONCILE_GOAL_JOB_NAME = 'reconcile-goal-progress' as const

// ── Deps ──────────────────────────────────────────────────────────────────

export type ReconcileGoalProgressDeps = Readonly<{
  goalRepo: GoalRepository
  metricApi: MetricPublicApi
  events: EventBus
  clock: () => Date
}>

// ── Handler factory ───────────────────────────────────────────────────────

export const createReconcileGoalProgressHandler =
  (deps: ReconcileGoalProgressDeps) =>
  async (_job: Job): Promise<ReconcileSummary> => {
    return trace('job.reconcileGoalProgress', async () => {
      const logger = getLogger()
      const now = deps.clock()

      const goals = await deps.goalRepo.findAllActive()
      let updated = 0
      let expired = 0
      let completed = 0
      let failed = 0

      for (const goal of goals) {
        try {
          // Skip recurring templates — they have no period, progress lives on instances
          if (goal.goalType === 'recurring' && !goal.periodStart && !goal.periodEnd) {
            continue
          }

          // 1. Build progress query
          const pqResult = buildProgressQuery(goal)
          if (pqResult.isErr()) {
            logger.warn(
              { goalId: goal.id, error: pqResult.error },
              'Skipping goal — cannot build progress query',
            )
            continue
          }
          const pq = pqResult.value

          // 2. Translate to metric repo query
          const mrq = progressQueryToMetricReadingsQuery(pq, goal)

          // 3. Query metric aggregate
          const aggregate = await deps.metricApi.queryAggregate(mrq)

          // 4. Compute value from aggregate
          const value = computeValue(goal.aggregationFunction, aggregate)

          // 5. Compare with stored progress and update if different
          const progress = await deps.goalRepo.getProgress(goal.id)
          if (!progress) {
            // First reconciliation — create initial progress row
            await deps.goalRepo.insertProgress({
              goalId: goal.id,
              currentValue: value,
              currentSum: goal.aggregationFunction === 'avg' ? aggregate.sum : null,
              currentCount: goal.aggregationFunction === 'avg' ? aggregate.count : null,
              lastComputedAt: now,
              computedSource: 'reconciliation',
            })
            updated++
          } else if (progress.currentValue !== value) {
            await deps.goalRepo.updateProgress(goal.id, {
              currentValue: value,
              currentSum: goal.aggregationFunction === 'avg' ? aggregate.sum : null,
              currentCount: goal.aggregationFunction === 'avg' ? aggregate.count : null,
              lastComputedAt: now,
              computedSource: 'reconciliation',
            })
            updated++
          }

          // 6. Expiry / completion for one-shot and recurring instances
          if (
            (goal.goalType === 'one_shot' ||
              (goal.goalType === 'recurring' && goal.parentGoalId !== null)) &&
            goal.periodEnd &&
            goal.periodEnd < now &&
            goal.status === 'active'
          ) {
            if (value >= goal.targetValue) {
              // Goal met its target before period ended → completed
              await deps.goalRepo.update(goal.id, goal.organizationId, {
                status: 'completed',
                completedAt: now,
                updatedAt: now,
              })
              completed++
            } else {
              // Period ended without meeting target → expired
              await deps.goalRepo.update(goal.id, goal.organizationId, {
                status: 'expired',
                updatedAt: now,
              })
              expired++
            }
          }
        } catch (err) {
          logger.error(
            { err, goalId: goal.id },
            'goal: error reconciling goal — skipping',
          )
          failed++
          continue
        }
      }

      const summary: ReconcileSummary = {
        goalsReconciled: goals.length,
        updated,
        expired,
        completed,
        failed,
      }

      logger.info(summary, 'Reconciled goal progress')
      return summary
    })
  }

// ── Summary type ──────────────────────────────────────────────────────────

export type ReconcileSummary = Readonly<{
  goalsReconciled: number
  updated: number
  expired: number
  completed: number
  failed: number
}>

// ── Helpers ───────────────────────────────────────────────────────────────

function progressQueryToMetricReadingsQuery(
  pq: ProgressQuery,
  goal: Goal,
): MetricReadingsQuery {
  const base: MetricReadingsQuery = {
    organizationId: goal.organizationId,
    propertyId: pq.scopeFilter.propertyId,
    portalId: pq.scopeFilter.portalId,
    groupId: pq.scopeFilter.groupId,
    metricKey: pq.metricKey,
  }

  switch (pq.timeFilter.tag) {
    case 'bounded':
      return {
        ...base,
        periodStart: pq.timeFilter.start,
        periodEnd: pq.timeFilter.end,
      }
    case 'sliding_window':
      return {
        ...base,
        rollingWindowDays: pq.timeFilter.days,
      }
    case 'none':
      return base
  }
}

function computeValue(
  agg: AggregationFunction,
  aggregate: MetricReadingsAggregate,
): number {
  switch (agg) {
    case 'sum':
      return aggregate.sum
    case 'count':
      return aggregate.count
    case 'max':
      return aggregate.max
    case 'avg':
      return aggregate.count > 0 ? aggregate.sum / aggregate.count : 0
  }
}
