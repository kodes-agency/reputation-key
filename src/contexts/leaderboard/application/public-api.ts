// Leaderboard context — public API surface.

export type { GetLeaderboardInput } from './use-cases/get-leaderboard'
export type { GetComparisonMatrixInput } from './use-cases/get-comparison-matrix'
export type {
  RecognitionBoardView,
  RecognitionSettings,
} from './ports/recognition.repository'
export type { LeaderboardEntryWithTarget } from '../domain/types'
export type { MatrixRow, MatrixCell } from '../domain/scoring'
