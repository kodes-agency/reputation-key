// Goal context — MetricRecorded event handler
// Increments goal progress for active goals matching the recorded metric.
// Per architecture: event handler subscribes via EventBus, drives repo + emits domain events.

import type { GoalRepository } from '../../application/ports/goal.repository'
import type { MetricRecorded } from '#/contexts/metric/application/public-api'
import type { EventBus } from '#/shared/events/event-bus'
import type { getLogger as getLoggerType } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import { shouldEmitCompleted } from '../../domain/progress-strategy'

// ── Dependencies ──────────────────────────────────────────────────────

export type OnMetricRecordedDeps = Readonly<{
  goalRepo: GoalRepository
  eventBus: EventBus
  clock: () => Date
  getLogger: typeof getLoggerType
  findGroupForPortal: (
    orgId: import('#/shared/domain/ids').OrganizationId,
    portalId: import('#/shared/domain/ids').PortalId,
  ) => Promise<{ portalGroupId: import('#/shared/domain/ids').PortalGroupId } | null>
}>

// ── Handler factory ───────────────────────────────────────────────────

export function onMetricRecorded(deps: OnMetricRecordedDeps) {
  return async (event: MetricRecorded): Promise<void> => {
    return trace('event.onMetricRecorded', async () => {
      const { goalRepo, eventBus, clock } = deps

      // Resolve portalGroupId if event has a portalId
      let resolvedPortalGroupId: import('#/shared/domain/ids').PortalGroupId | null = null
      if (event.portalId) {
        try {
          const group = await deps.findGroupForPortal(
            event.organizationId,
            event.portalId,
          )
          resolvedPortalGroupId = group?.portalGroupId ?? null
        } catch (err) {
          // Group lookup failure shouldn't block metric processing
          deps
            .getLogger()
            .warn({ portalId: event.portalId, err }, 'portal group resolution failed')
        }
      }

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
        deps
          .getLogger()
          .error(
            { err, metricKey: event.metricKey },
            'goal: fatal error querying goals in onMetricRecorded',
          )
        return
      }

      // No matching goals — nothing to do
      if (affectedGoals.length === 0) return

      for (const goal of affectedGoals) {
        try {
          // Get previous progress value for GoalProgressUpdated
          const prevProgress = await goalRepo.getProgress(goal.id)
          const previousValue = prevProgress?.currentValue ?? 0

          // Increment progress (insert initial row if none exists)
          const result = await goalRepo.upsertProgress(
            goal.id,
            goal.organizationId,
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
            await goalRepo.markGoalCompleted(goal.id, goal.organizationId, now)

            await eventBus.emit({
              _tag: 'goal.completed',
              eventId: crypto.randomUUID(),
              correlationId: null,
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
              createdBy: goal.createdBy,
            })
          }
        } catch (err) {
          deps
            .getLogger()
            .error(
              { err, goalId: goal.id, metricKey: event.metricKey },
              'goal: error processing metric.recorded for goal',
            )
          // continue processing other goals
        }
      }
    })
  }
}
