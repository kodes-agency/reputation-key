// Leaderboard context — build function.
// Event handlers are registered at build time so every process handles events.

import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import { createLeaderboardRepository } from './infrastructure/repositories/leaderboard.repository'
import { registerLeaderboardEventHandlers } from './infrastructure/event-handlers'
import type { LeaderboardRepository } from './application/ports/leaderboard.repository'
import type {
  LeaderboardEntryWithTarget,
  LeaderboardRefreshInput,
  LeaderboardReconcileResult,
} from './domain/types'
import type { GetLeaderboardQuery } from './application/ports/leaderboard.repository'

export type LeaderboardContextApi = Readonly<{
  publicApi: Readonly<{
    getLeaderboard: (
      input: GetLeaderboardQuery,
    ) => Promise<ReadonlyArray<LeaderboardEntryWithTarget>>
  }>
  internal: Readonly<{
    repos: Readonly<{ leaderboardRepo: LeaderboardRepository }>
    useCases: Readonly<{
      refreshLeaderboard: (
        input: LeaderboardRefreshInput,
      ) => Promise<LeaderboardReconcileResult>
      reconcileLeaderboards: () => Promise<LeaderboardReconcileResult>
    }>
  }>
}>

export type BuildLeaderboardContextDeps = Readonly<{
  db: Database
  events: EventBus
}>

export const buildLeaderboardContext = (
  deps: BuildLeaderboardContextDeps,
): LeaderboardContextApi => {
  const leaderboardRepo = createLeaderboardRepository(deps.db, deps.events)

  registerLeaderboardEventHandlers({
    eventBus: deps.events,
    refreshLeaderboard: leaderboardRepo.refresh,
  })

  return {
    publicApi: {
      getLeaderboard: leaderboardRepo.getLeaderboard,
    },
    internal: {
      repos: { leaderboardRepo },
      useCases: {
        refreshLeaderboard: leaderboardRepo.refresh,
        reconcileLeaderboards: leaderboardRepo.reconcileAll,
      },
    },
  }
}
