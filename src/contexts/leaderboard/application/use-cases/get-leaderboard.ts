// Leaderboard context — get leaderboard use case (LB-04)

import type {
  LeaderboardRepository,
  GetLeaderboardQuery,
} from '../ports/leaderboard.repository'
import type { LeaderboardEntryWithTarget } from '../../domain/types'

export type GetLeaderboardDeps = Readonly<{
  repo: LeaderboardRepository
}>

export type GetLeaderboardInput = GetLeaderboardQuery

export type GetLeaderboardReturn = ReadonlyArray<LeaderboardEntryWithTarget>

export const getLeaderboard =
  (deps: GetLeaderboardDeps) =>
  async (input: GetLeaderboardInput): Promise<GetLeaderboardReturn> => {
    return deps.repo.getLeaderboard(input)
  }
