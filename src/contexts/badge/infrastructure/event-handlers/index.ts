// Badge context — event handler registration
// Wires metric.recorded → badge evaluation.
// Per architecture: "Handlers should not throw. Failures are logged, not propagated to the emitter."

import type { EventBus } from '#/shared/events/event-bus'
import type { EvaluateBadgeForTargetInput } from '../../application/use-cases/evaluate-badge-for-target'
import type { BadgeEvaluationResult } from '../../domain/types'

export type RegisterBadgeHandlersDeps = Readonly<{
  eventBus: EventBus
  evaluateBadgeForTarget: (
    input: EvaluateBadgeForTargetInput,
  ) => Promise<ReadonlyArray<BadgeEvaluationResult>>
}>

export const registerBadgeEventHandlers = (deps: RegisterBadgeHandlersDeps): void => {
  deps.eventBus.on(
    'metric.recorded',
    async (event) => {
      const tasks: Promise<unknown>[] = []

      if (event.portalId) {
        tasks.push(
          deps.evaluateBadgeForTarget({
            organizationId: event.organizationId,
            propertyId: event.propertyId,
            targetType: 'portal',
            targetId: event.portalId,
          }),
        )
      }

      if (event.groupId) {
        tasks.push(
          deps.evaluateBadgeForTarget({
            organizationId: event.organizationId,
            propertyId: event.propertyId,
            targetType: 'portal_group',
            targetId: event.groupId,
          }),
        )
      }

      await Promise.allSettled(tasks)
    },
    { consumer: 'badge.event-handlers' },
  )
}
