// Leaderboard context — reconcile all leaderboards use case (LB-04)

import type { LeaderboardRepository } from '../ports/leaderboard.repository'
import type { LeaderboardReconcileResult } from '../../domain/types'

export type ReconcileLeaderboardsDeps = Readonly<{
  repo: LeaderboardRepository
}>

export type ReconcileLeaderboardsReturn = LeaderboardReconcileResult

export const reconcileLeaderboards =
  (deps: ReconcileLeaderboardsDeps) => async (): Promise<ReconcileLeaderboardsReturn> => {
    return deps.repo.reconcileAll()
  }
