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
    // Only refresh the current period — full hourly reconcile catches the rest
    await Promise.allSettled([
      deps.refreshLeaderboard({
        organizationId: event.organizationId,
        propertyId: event.propertyId,
        period: 'this_month',
        scope: event.portalId ? 'portal' : 'portal_group',
        metricKey: 'overall',
      }),
    ])
  })
}
