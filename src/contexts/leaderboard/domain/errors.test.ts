import { describe, expect, it } from 'vitest'
import { isLeaderboardError, leaderboardError } from './errors'

describe('leaderboard domain errors', () => {
  it('constructs tagged errors with optional context', () => {
    expect(leaderboardError('forbidden', 'denied', { role: 'member' })).toMatchObject({
      _tag: 'LeaderboardError',
      code: 'forbidden',
      message: 'denied',
      context: { role: 'member' },
    })
    expect(leaderboardError('not_found', 'missing')).not.toHaveProperty('context')
  })

  it.each([
    [leaderboardError('invalid_input', 'invalid'), true],
    [null, false],
    ['LeaderboardError', false],
    [{}, false],
    [{ _tag: 'OtherError' }, false],
  ])('recognizes only leaderboard errors', (value, expected) => {
    expect(isLeaderboardError(value)).toBe(expected)
  })
})
