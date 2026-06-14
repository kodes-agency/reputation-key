// Leaderboard context — domain errors

import { createErrorFactory } from '#/shared/domain/errors'

export type LeaderboardErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'invalid_input'
  | 'repo_insert_failed'

export type LeaderboardError = Readonly<{
  _tag: 'LeaderboardError'
  code: LeaderboardErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

export const leaderboardError =
  createErrorFactory<LeaderboardError['_tag']>('LeaderboardError')

export const isLeaderboardError = (e: unknown): e is LeaderboardError =>
  typeof e === 'object' &&
  e !== null &&
  (e as LeaderboardError)._tag === 'LeaderboardError'
