import { describe, expect, it } from 'vitest'
import {
  axisTicks,
  bucketStart,
  groupByBucket,
  hasEnoughEvidence,
  MAX_AXIS_TICKS,
} from './chart-buckets'

type Row = { date: string; count: number }
const row = (date: string, count = 1): Row => ({ date, count })
const pick = (row: Row) => row.date

describe('bucketStart', () => {
  it('opens a week bucket on Monday regardless of which day lands in it', () => {
    // 2026-09-11 is a Friday; 2026-09-07 is that week's Monday.
    expect(bucketStart('2026-09-11', 'week')).toBe('2026-09-07')
    expect(bucketStart('2026-09-07', 'week')).toBe('2026-09-07')
    // Sunday belongs to the week that started six days earlier, not the next one.
    expect(bucketStart('2026-09-13', 'week')).toBe('2026-09-07')
    expect(bucketStart('2026-09-14', 'week')).toBe('2026-09-14')
  })

  it('opens a month bucket on the first, and a day bucket on itself', () => {
    expect(bucketStart('2026-09-30', 'month')).toBe('2026-09-01')
    expect(bucketStart('2026-09-30', 'day')).toBe('2026-09-30')
  })
})

describe('groupByBucket', () => {
  it('collects rows into their bucket and keeps them in date order', () => {
    const buckets = groupByBucket(
      [row('2026-09-13'), row('2026-09-07'), row('2026-09-16')],
      'week',
      pick,
    )
    expect(buckets.map((bucket) => bucket.start)).toEqual(['2026-09-07', '2026-09-14'])
    expect(buckets[0]!.rows).toHaveLength(2)
    expect(buckets[1]!.rows).toHaveLength(1)
  })

  it('keeps a quiet period as an empty bucket instead of closing the gap', () => {
    const buckets = groupByBucket([row('2026-01-05'), row('2026-04-20')], 'month', pick)
    expect(buckets).toHaveLength(4)
    expect(buckets.map((bucket) => bucket.rows.length)).toEqual([1, 0, 0, 1])
  })

  it('labels the first bucket of each year with its year and the rest without', () => {
    const buckets = groupByBucket(
      [row('2025-11-03'), row('2026-01-05'), row('2026-02-02')],
      'month',
      pick,
    )
    expect(buckets.map((bucket) => bucket.label)).toEqual([
      'Nov 2025',
      'Dec',
      'Jan 2026',
      'Feb',
    ])
  })

  it('drops rows with no date and returns nothing when none survive', () => {
    const rows = [{ date: null, count: 1 }, row('2026-09-07')]
    const buckets = groupByBucket(rows, 'week', (candidate) => candidate.date)
    expect(buckets).toHaveLength(1)
    expect(
      groupByBucket([{ date: null }], 'week', (candidate) => candidate.date),
    ).toEqual([])
  })
})

describe('axisTicks', () => {
  it('returns every bucket when they fit', () => {
    const buckets = groupByBucket(
      ['2026-09-01', '2026-09-02', '2026-09-03'].map((date) => row(date)),
      'day',
      pick,
    )
    expect(axisTicks(buckets)).toHaveLength(3)
  })

  it('thins a long axis to the cap, keeping the first and last bucket', () => {
    const buckets = groupByBucket(
      Array.from({ length: 30 }, (_, index) =>
        row(`2026-09-${String(index + 1).padStart(2, '0')}`),
      ),
      'day',
      pick,
    )
    const ticks = axisTicks(buckets)
    expect(ticks).toHaveLength(MAX_AXIS_TICKS)
    expect(ticks[0]).toBe('2026-09-01')
    expect(ticks[ticks.length - 1]).toBe('2026-09-30')
  })
})

describe('hasEnoughEvidence', () => {
  it('counts populated buckets only, so a long empty window is still too thin', () => {
    const sparse = groupByBucket([row('2026-01-05'), row('2026-06-20')], 'month', pick)
    expect(sparse.length).toBeGreaterThan(3)
    expect(hasEnoughEvidence(sparse)).toBe(false)

    const dense = groupByBucket(
      [row('2026-01-05'), row('2026-02-05'), row('2026-03-05')],
      'month',
      pick,
    )
    expect(hasEnoughEvidence(dense)).toBe(true)
  })
})
