// Goal context — MetricRecorded event handler
// Increments goal progress for active goals matching the recorded metric.
// Per architecture: event handler subscribes via EventBus, drives repo + emits domain events.

import type { GoalRepository } from '../../application/ports/goal.repository'
import type { MetricRecorded } from '#/contexts/metric/application/public-api'
import type { EventBus } from '#/shared/events/event-bus'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { trace } from '#/shared/observability/trace'
import { shouldEmitCompleted } from '../../domain/progress-strategy'
import { goalCompleted } from '../../domain/events'

// ── Dependencies ──────────────────────────────────────────────────────

export type OnMetricRecordedDeps = Readonly<{
  goalRepo: GoalRepository
  eventBus: EventBus
  clock: () => Date
  logger: Pick<LoggerPort, 'error'>
}>

// ── Handler factory ───────────────────────────────────────────────────

/**
 * @deprecated Compatibility-only implementation for the retired `goals` /
 * `goal_progress` model. It is intentionally absent from active handler
 * registration; canonical beta Goal Programs reconcile monthly results.
 */
export const onMetricRecorded = (deps: OnMetricRecordedDeps) => {
  return async (event: MetricRecorded): Promise<void> => {
    return trace('event.onMetricRecorded', async () => {
      const { goalRepo, eventBus, clock } = deps

      if (!event.permittedConsumers.includes('goal')) return
      const resolvedPortalGroupId = event.portalGroupId

      let affectedGoals
      try {
        affectedGoals = await goalRepo.findActiveGoalsByMetric(
          event.metricKey,
          event.organizationId,
          event.propertyId,
          event.portalId,
          resolvedPortalGroupId,
        )
      } catch (err) {
        deps.logger.error(
          { err, metricKey: event.metricKey },
          'goal: fatal error querying goals in onMetricRecorded',
        )
        return
      }

      // No matching goals — nothing to do
      if (affectedGoals.length === 0) return

      for (const goal of affectedGoals) {
        // GOAL-01: Skip recurring templates (parentGoalId === null).
        // Templates aggregate no progress themselves — only instances do.
        if (goal.goalType === 'recurring' && goal.parentGoalId === null) continue
        try {
          // Increment progress (insert initial row if none exists)
          const result = await goalRepo.upsertProgress(
            goal.id,
            goal.organizationId,
            goal.aggregationFunction,
            event.value,
          )

          const now = clock()

          // Check completion
          if (result.currentValue >= goal.targetValue && shouldEmitCompleted(goal)) {
            await goalRepo.markGoalCompleted(goal.id, goal.organizationId, now)

            await eventBus.emit(
              goalCompleted({
                goalId: goal.id,
                organizationId: goal.organizationId,
                propertyId: goal.propertyId,
                portalId: goal.portalId,
                portalGroupId: goal.portalGroupId,
                goalType: goal.goalType,
                aggregationFunction: goal.aggregationFunction,
                metricKey: goal.metricKey,
                targetValue: goal.targetValue,
                completedValue: result.currentValue,
                completedAt: now,
                parentGoalId: goal.parentGoalId,
                userId: goal.createdBy,
                occurredAt: now,
                correlationId: event.correlationId,
              }),
            )
          }
        } catch (err) {
          deps.logger.error(
            { err, metricKey: event.metricKey },
            'goal: error processing metric.recorded for goal',
          )
          // continue processing other goals
        }
      }
    })
  }
}
