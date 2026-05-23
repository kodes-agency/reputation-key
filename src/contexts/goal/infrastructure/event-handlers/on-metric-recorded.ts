// Goal context — MetricRecorded event handler
// Increments goal progress for active goals matching the recorded metric.
// Per architecture: event handler subscribes via EventBus, drives repo + emits domain events.

import type { GoalRepository } from '../../application/ports/goal.repository'
import type { Goal } from '../../domain/types'
import type { MetricRecorded } from '#/contexts/metric/application/public-api'
import type { GoalCompleted, GoalProgressUpdated } from '../../domain/events'
import { trace } from '#/shared/observability/trace'

// ── EventBus port (minimal, for this handler only) ─────────────────────

export type EventBus = Readonly<{
  emit(event: GoalCompleted | GoalProgressUpdated): Promise<void>
}>

// ── Dependencies ──────────────────────────────────────────────────────

export type OnMetricRecordedDeps = Readonly<{
  goalRepo: GoalRepository
  eventBus: EventBus
  clock: () => Date
}>

// ── Completion rules ──────────────────────────────────────────────────
//
// AVG one-shot / recurring instance: skip immediate completion;
// reconciliation handles this at period end.
// All other combinations: emit GoalCompleted immediately when target met.

function shouldEmitCompleted(goal: Goal): boolean {
  if (goal.aggregationFunction === 'avg') {
    // AVG open + rolling: complete immediately
    // AVG one_shot + recurring (instance): defer to reconciliation
    if (goal.goalType === 'one_shot' || goal.goalType === 'recurring') {
      return false
    }
  }
  return true
}

// ── Handler factory ───────────────────────────────────────────────────

export function onMetricRecorded(deps: OnMetricRecordedDeps) {
  return async (event: MetricRecorded): Promise<void> => {
    return trace('event.onMetricRecorded', async () => {
      const { goalRepo, eventBus, clock } = deps

      const affectedGoals = await goalRepo.findActiveGoalsByMetric(
        event.metricKey,
        event.organizationId,
        event.propertyId,
        event.portalId,
      )

      // No matching goals — nothing to do
      if (affectedGoals.length === 0) return

      for (const goal of affectedGoals) {
        // Get previous progress value for GoalProgressUpdated
        const prevProgress = await goalRepo.getProgress(goal.id)
        const previousValue = prevProgress?.currentValue ?? 0

        // Increment progress
        const result = await goalRepo.incrementProgress(
          goal.id,
          goal.aggregationFunction,
          event.value,
        )

        const now = clock()

        // Emit GoalProgressUpdated
        await eventBus.emit({
          _tag: 'goal.progress_updated',
          goalId: goal.id,
          organizationId: goal.organizationId,
          metricKey: goal.metricKey,
          previousValue,
          currentValue: result.currentValue,
          computedSource: 'event_increment',
          occurredAt: now,
        })

        // Check completion
        if (result.currentValue >= goal.targetValue && shouldEmitCompleted(goal)) {
          await goalRepo.markGoalCompleted(goal.id, now)

          await eventBus.emit({
            _tag: 'goal.completed',
            goalId: goal.id,
            organizationId: goal.organizationId,
            propertyId: goal.propertyId,
            portalId: goal.portalId,
            teamId: goal.teamId,
            staffId: goal.staffId,
            goalType: goal.goalType,
            aggregationFunction: goal.aggregationFunction,
            metricKey: goal.metricKey,
            targetValue: goal.targetValue,
            completedValue: result.currentValue,
            completedAt: now,
            parentGoalId: goal.parentGoalId,
            createdBy: goal.createdBy,
          })
        }
      }
    })
  }
}
