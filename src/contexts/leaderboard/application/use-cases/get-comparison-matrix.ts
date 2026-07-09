// Leaderboard context — get comparison matrix use case

import type {
  LeaderboardRepository,
  GetComparisonMatrixQuery,
} from '../ports/leaderboard.repository'
import type { MatrixRow } from '../../domain/scoring'

export type GetComparisonMatrixDeps = Readonly<{
  repo: LeaderboardRepository
}>

export type GetComparisonMatrixInput = GetComparisonMatrixQuery

export type GetComparisonMatrixReturn = ReadonlyArray<MatrixRow>

export const getComparisonMatrix =
  (deps: GetComparisonMatrixDeps) =>
  async (input: GetComparisonMatrixInput): Promise<GetComparisonMatrixReturn> => {
    return deps.repo.getComparisonMatrix(input)
  }
