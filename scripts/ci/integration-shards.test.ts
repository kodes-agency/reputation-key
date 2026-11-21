import { describe, expect, it } from 'vitest'
import { shardOf } from './integration-shards'

const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
const durations = {
  a: 40_000,
  b: 30_000,
  c: 20_000,
  d: 10_000,
  e: 5_000,
  f: 5_000,
  g: 1_000,
}

const shards = (
  count: number,
  record: Record<string, number> = durations,
  list = files,
) => Array.from({ length: count }, (_, i) => shardOf(list, record, i + 1, count))

const load = (shard: readonly string[], record: Record<string, number> = durations) =>
  shard.reduce((sum, file) => sum + (record[file] ?? 0) + 1_000, 0)

describe('shardOf', () => {
  it('runs every file in exactly one shard', () => {
    for (const count of [1, 2, 3, 4, 7, 9]) {
      const all = shards(count).flat()
      expect(all.sort()).toEqual([...files].sort())
    }
  })

  it('balances by recorded duration, not by file count', () => {
    const [first, second, third] = shards(3)
    expect(first).toEqual(['a'])
    expect(second).toEqual(['b', 'e', 'g'])
    expect(third).toEqual(['c', 'd', 'f'])
    expect([load(first!), load(second!), load(third!)]).toEqual([41_000, 39_000, 38_000])
  })

  it('gives every shard the same split whatever order the files arrive in', () => {
    const reversed = [...files].reverse()
    for (let index = 1; index <= 3; index++) {
      expect(shardOf(reversed, durations, index, 3).sort()).toEqual(
        shardOf(files, durations, index, 3).sort(),
      )
    }
  })

  it('keeps the given order inside a shard', () => {
    expect(shardOf(['g', 'f', 'b'], durations, 1, 1)).toEqual(['g', 'f', 'b'])
  })

  it('costs a file the record does not know at the median recorded duration', () => {
    const record = { a: 10_000, b: 2_000, c: 4_000 }
    const [first, second] = shards(2, record, ['a', 'b', 'c', 'new'])
    expect(first).toEqual(['a'])
    expect(second).toEqual(['b', 'c', 'new'])
  })

  it('still splits evenly with no record at all', () => {
    const counts = shards(3, {}).map((shard) => shard.length)
    expect(counts.sort()).toEqual([2, 2, 3])
  })

  it.each([
    [0, 3],
    [4, 3],
    [1.5, 3],
    [1, 0],
  ])('refuses shard %s of %s', (index, count) => {
    expect(() => shardOf(files, durations, index, count)).toThrow(/^shard /)
  })
})
