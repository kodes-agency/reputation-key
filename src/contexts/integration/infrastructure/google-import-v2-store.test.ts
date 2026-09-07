import { describe, expect, it } from 'vitest'
import { googleImportProgressPollAfterMs } from './google-import-v2-store'

const NOW = new Date('2026-08-12T10:00:00.000Z')

describe('googleImportProgressPollAfterMs', () => {
  const NOW_MS = NOW.getTime()
  const staleBy = (ms: number) => NOW_MS - ms

  it('stops polling a terminal parent', () => {
    for (const status of [
      'completed',
      'completed_with_issues',
      'failed',
      'cancelled',
    ] as const) {
      expect(googleImportProgressPollAfterMs(status, staleBy(0), NOW_MS)).toBeNull()
    }
  })

  it.each([
    ['queued', 0, 1_000],
    ['processing', 29_999, 1_000],
    ['processing', 30_000, 5_000],
    ['queued', 119_999, 5_000],
    ['processing', 120_000, 15_000],
    // Hours of no movement never polls faster than the cap.
    ['processing', 6 * 60 * 60_000, 15_000],
  ] as const)(
    'backs off a %s parent stale by %ims to %ims',
    (status, stale, expected) => {
      expect(googleImportProgressPollAfterMs(status, staleBy(stale), NOW_MS)).toBe(
        expected,
      )
    },
  )

  it('is monotonic in staleness and never exceeds the cap', () => {
    let previous = 0
    for (const stale of [0, 1_000, 29_999, 30_000, 60_000, 120_000, 10 * 60_000]) {
      const interval = googleImportProgressPollAfterMs(
        'processing',
        staleBy(stale),
        NOW_MS,
      )!
      expect(interval).toBeGreaterThanOrEqual(previous)
      expect(interval).toBeLessThanOrEqual(15_000)
      previous = interval
    }
  })

  it('returns the fast interval for a clock-skewed future updatedAt', () => {
    expect(googleImportProgressPollAfterMs('processing', NOW_MS + 60_000, NOW_MS)).toBe(
      1_000,
    )
    expect(googleImportProgressPollAfterMs('processing', Number.NaN, NOW_MS)).toBe(1_000)
  })
})
