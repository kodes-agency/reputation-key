import { describe, expect, it } from 'vitest'
import { pickLeastRecentlyUsed } from './reply-rotation'

describe('pickLeastRecentlyUsed', () => {
  it('chooses unused before the oldest used option', () => {
    expect(
      pickLeastRecentlyUsed(
        [{ key: 'a' }, { key: 'b' }, { key: 'c' }],
        [
          { key: 'a', usedAtEpochMillis: 100 },
          { key: 'b', usedAtEpochMillis: 50 },
        ],
        'review-1',
      ),
    ).toEqual({ key: 'c' })
  })

  it('uses the latest publication per key and chooses the oldest', () => {
    expect(
      pickLeastRecentlyUsed(
        ['a', 'b'],
        [
          { key: 'a', usedAtEpochMillis: 10 },
          { key: 'a', usedAtEpochMillis: 100 },
          { key: 'b', usedAtEpochMillis: 50 },
        ],
        'review-1',
      ),
    ).toBe('b')
  })

  it('breaks equal ties deterministically', () => {
    const first = pickLeastRecentlyUsed(['a', 'b', 'c'], [], 'same-seed')
    expect(pickLeastRecentlyUsed(['c', 'a', 'b'], [], 'same-seed')).toBe(first)
  })
})
