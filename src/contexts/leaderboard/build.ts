// Leaderboard context — build function.
// Event handlers are registered at build time so every process handles events.

import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { Clock } from '#/shared/domain/clock'
import { createLeaderboardRepository } from './infrastructure/repositories/leaderboard.repository'
import { registerLeaderboardEventHandlers } from './infrastructure/event-handlers'
import type { LeaderboardRepository } from './application/ports/leaderboard.repository'
import { refreshLeaderboard } from './application/use-cases/refresh-leaderboard'
import { reconcileLeaderboards } from './application/use-cases/reconcile-leaderboards'
import { getLeaderboard } from './application/use-cases/get-leaderboard'
import { getComparisonMatrix } from './application/use-cases/get-comparison-matrix'
import type {
  RefreshLeaderboardInput,
  RefreshLeaderboardReturn,
} from './application/use-cases/refresh-leaderboard'
import type { ReconcileLeaderboardsReturn } from './application/use-cases/reconcile-leaderboards'
import type {
  GetLeaderboardInput,
  GetLeaderboardReturn,
} from './application/use-cases/get-leaderboard'
import type {
  GetComparisonMatrixInput,
  GetComparisonMatrixReturn,
} from './application/use-cases/get-comparison-matrix'

export type LeaderboardContextApi = Readonly<{
  publicApi: Readonly<{
    getLeaderboard: (input: GetLeaderboardInput) => Promise<GetLeaderboardReturn>
    getComparisonMatrix: (
      input: GetComparisonMatrixInput,
    ) => Promise<GetComparisonMatrixReturn>
  }>
  internal: Readonly<{
    repos: Readonly<{ leaderboardRepo: LeaderboardRepository }>
    useCases: Readonly<{
      refreshLeaderboard: (
        input: RefreshLeaderboardInput,
      ) => Promise<RefreshLeaderboardReturn>
      reconcileLeaderboards: () => Promise<ReconcileLeaderboardsReturn>
    }>
  }>
}>

export type BuildLeaderboardContextDeps = Readonly<{
  db: Database
  events: EventBus
  outboxRepo?: import('#/shared/outbox').OutboxRepository
  clock: Clock
}>

export const buildLeaderboardContext = (
  deps: BuildLeaderboardContextDeps,
): LeaderboardContextApi => {
  const leaderboardRepo = createLeaderboardRepository(deps.db, deps.clock)

  const refreshLeaderboardFn = refreshLeaderboard({ repo: leaderboardRepo })
  const reconcileLeaderboardsFn = reconcileLeaderboards({ repo: leaderboardRepo })
  const getLeaderboardFn = getLeaderboard({ repo: leaderboardRepo })
  const getComparisonMatrixFn = getComparisonMatrix({ repo: leaderboardRepo })

  registerLeaderboardEventHandlers({
    eventBus: deps.events,
    refreshLeaderboard: refreshLeaderboardFn,
  })

  return {
    publicApi: {
      getLeaderboard: getLeaderboardFn,
      getComparisonMatrix: getComparisonMatrixFn,
    },
    internal: {
      repos: { leaderboardRepo },
      useCases: {
        refreshLeaderboard: refreshLeaderboardFn,
        reconcileLeaderboards: reconcileLeaderboardsFn,
      },
    },
  }
}
