// Leaderboard context — event handler registration
// Wires metric.recorded → targeted leaderboard snapshot refresh.
// Per architecture: "Handlers should not throw. Failures are logged, not propagated to the emitter."

import type { EventBus } from '#/shared/events/event-bus'
import type {
  LeaderboardRefreshInput,
  LeaderboardReconcileResult,
} from '../../domain/types'

export type RegisterLeaderboardHandlersDeps = Readonly<{
  eventBus: EventBus
  refreshLeaderboard: (
    input: LeaderboardRefreshInput,
  ) => Promise<LeaderboardReconcileResult>
}>

export const registerLeaderboardEventHandlers = (
  deps: RegisterLeaderboardHandlersDeps,
): void => {
  deps.eventBus.on('metric.recorded', async (event) => {
    // Only refresh the current period — full hourly reconcile catches the rest.
    // A portal-scoped reading refreshes the portal leaderboard AND, when the
    // portal belongs to a group (event.groupId, resolved by the metric
    // handler), the portal_group leaderboard. A group-scoped reading with no
    // specific portal refreshes portal_group only. Property-level readings
    // (portalId and groupId both null, e.g. property.review) don't participate
    // in portal/group leaderboards — skip; the hourly reconcile covers them.
    const tasks: Promise<unknown>[] = []
    const base = {
      organizationId: event.organizationId,
      propertyId: event.propertyId,
      period: 'this_month' as const,
      metricKey: 'overall' as const,
    }
    if (event.portalId) {
      tasks.push(deps.refreshLeaderboard({ ...base, scope: 'portal' }))
      if (event.groupId) {
        tasks.push(deps.refreshLeaderboard({ ...base, scope: 'portal_group' }))
      }
    } else if (event.groupId) {
      tasks.push(deps.refreshLeaderboard({ ...base, scope: 'portal_group' }))
    }
    await Promise.allSettled(tasks)
  })
}
