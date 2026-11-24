import { describe, expect, it } from 'vitest'
import { orderOptions, pickLeastRecentlyUsed } from './reply-rotation'

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

describe('orderOptions', () => {
  it('orders unused indexes first, then least recently used', () => {
    const order = orderOptions(
      3,
      [
        { key: '0', usedAtEpochMillis: 300 },
        { key: '2', usedAtEpochMillis: 100 },
      ],
      'seed',
    )

    expect(order).toEqual([1, 2, 0])
  })

  it('starts with the index pickLeastRecentlyUsed chooses', () => {
    const usage = [{ key: '1', usedAtEpochMillis: 5 }]
    const first = pickLeastRecentlyUsed(['0', '1', '2'], usage, 'seed')

    expect(orderOptions(3, usage, 'seed')[0]).toBe(Number(first))
  })

  it('is empty when there are no options', () => {
    expect(orderOptions(0, [], 'seed')).toEqual([])
  })
})
