// Leaderboard context — event handler registration
// Wires metric.recorded → targeted leaderboard snapshot refresh.
// Per architecture: "Handlers should not throw. Failures are logged, not propagated to the emitter."

import type { EventBus } from '#/shared/events/event-bus'
import type {
  LeaderboardRefreshInput,
  LeaderboardReconcileResult,
} from '../../domain/types'
import { LEADERBOARD_METRICS } from '../../domain/scoring'

export type RegisterLeaderboardHandlersDeps = Readonly<{
  eventBus: EventBus
  refreshLeaderboard: (
    input: LeaderboardRefreshInput,
  ) => Promise<LeaderboardReconcileResult>
}>

export const registerLeaderboardEventHandlers = (
  deps: RegisterLeaderboardHandlersDeps,
): void => {
  deps.eventBus.on(
    'metric.recorded',
    async (event) => {
      // Only refresh the current period — full hourly reconcile catches the rest.
      // Skip metrics the leaderboard doesn't rank (e.g. property-scoped reviews).
      if (!LEADERBOARD_METRICS.includes(event.metricKey)) return
      await Promise.allSettled([
        deps.refreshLeaderboard({
          organizationId: event.organizationId,
          propertyId: event.propertyId,
          period: 'this_month',
          scope: event.portalId ? 'portal' : 'portal_group',
          metricKey: event.metricKey,
        }),
      ])
    },
    { consumer: 'leaderboard.event-handlers' },
  )
}
