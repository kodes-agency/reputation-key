// Leaderboard context — refresh leaderboard use case (LB-04)

import type { LeaderboardRepository } from '../ports/leaderboard.repository'
import type {
  LeaderboardRefreshInput,
  LeaderboardReconcileResult,
} from '../../domain/types'

export type RefreshLeaderboardDeps = Readonly<{
  repo: LeaderboardRepository
}>

export type RefreshLeaderboardInput = LeaderboardRefreshInput

export type RefreshLeaderboardReturn = LeaderboardReconcileResult

export const refreshLeaderboard =
  (deps: RefreshLeaderboardDeps) =>
  async (input: RefreshLeaderboardInput): Promise<RefreshLeaderboardReturn> => {
    return deps.repo.refresh(input)
  }
