// Review context — how long a failed snapshot run waits before its retry.

import { describe, it, expect } from 'vitest'
import {
  LOCATION_TOO_LARGE_RETRY_MS,
  SNAPSHOT_FAILURE_MAX_RETRY_MS,
  snapshotFailureRetryMs,
  type PreviousSnapshotFailure,
} from './snapshot-failure-backoff'

const NOW = new Date('2026-10-21T12:00:00.000Z')
const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const BASE_MS = 15 * MINUTE_MS

const after = (ms: number, from: Date = NOW): Date => new Date(from.getTime() + ms)
const before = (ms: number, from: Date = NOW): Date => new Date(from.getTime() - ms)

/** A failure recorded `agoMs` before NOW whose retry was dated `intervalMs` after it. */
const failedAgo = (agoMs: number, intervalMs: number): PreviousSnapshotFailure => {
  const failedAt = before(agoMs)
  return {
    errorClass: 'provider_failure',
    failedAt,
    retryAt: after(intervalMs, failedAt),
  }
}

const retryMs = (
  previous: PreviousSnapshotFailure | null,
  over: Partial<Parameters<typeof snapshotFailureRetryMs>[0]> = {},
): number =>
  snapshotFailureRetryMs({
    previous,
    now: NOW,
    baseIntervalMs: BASE_MS,
    locationTooLarge: false,
    ...over,
  })

describe('constants', () => {
  it('caps the retry at six hours so Goals 24 h freshness rule still holds', () => {
    expect(SNAPSHOT_FAILURE_MAX_RETRY_MS).toBe(6 * HOUR_MS)
  })

  it('parks a location over the cap for a day', () => {
    expect(LOCATION_TOO_LARGE_RETRY_MS).toBe(24 * HOUR_MS)
  })
})

describe('snapshotFailureRetryMs', () => {
  it('waits the base interval after the first failure (no failure outstanding)', () => {
    expect(retryMs(null)).toBe(15 * MINUTE_MS)
  })

  it('waits the base interval when the stored failure was cleared by a completed run', () => {
    const cleared: PreviousSnapshotFailure = {
      errorClass: null,
      failedAt: before(2 * HOUR_MS),
      retryAt: before(HOUR_MS),
    }
    expect(retryMs(cleared)).toBe(15 * MINUTE_MS)
  })

  it('waits one hour after the second failure, when the first retry came due', () => {
    expect(retryMs(failedAgo(16 * MINUTE_MS, 15 * MINUTE_MS))).toBe(HOUR_MS)
  })

  it('waits four hours after the third failure', () => {
    expect(retryMs(failedAgo(61 * MINUTE_MS, HOUR_MS))).toBe(4 * HOUR_MS)
  })

  it('caps the wait at six hours after the fourth and every later failure', () => {
    expect(retryMs(failedAgo(4 * HOUR_MS + MINUTE_MS, 4 * HOUR_MS))).toBe(6 * HOUR_MS)
    expect(retryMs(failedAgo(6 * HOUR_MS + MINUTE_MS, 6 * HOUR_MS))).toBe(6 * HOUR_MS)
  })

  it('follows the configured base interval, not a fixed 15 minutes', () => {
    expect(retryMs(null, { baseIntervalMs: 5 * MINUTE_MS })).toBe(5 * MINUTE_MS)
    expect(
      retryMs(failedAgo(6 * MINUTE_MS, 5 * MINUTE_MS), { baseIntervalMs: 5 * MINUTE_MS }),
    ).toBe(20 * MINUTE_MS)
  })

  it('parks a location over the cap for a day, whatever came before', () => {
    expect(retryMs(null, { locationTooLarge: true })).toBe(24 * HOUR_MS)
    expect(
      retryMs(failedAgo(16 * MINUTE_MS, 15 * MINUTE_MS), { locationTooLarge: true }),
    ).toBe(24 * HOUR_MS)
  })

  it('starts the ladder again from the base after a parked day (24 h previous, capped to six hours)', () => {
    expect(retryMs(failedAgo(24 * HOUR_MS + MINUTE_MS, 24 * HOUR_MS))).toBe(6 * HOUR_MS)
  })

  it('keeps the previous wait when the failure is a queue retry of the same attempt', () => {
    // The first failure dated its retry 15 minutes out; this one lands two
    // minutes later, before that retry came due: the queue retried the job.
    expect(retryMs(failedAgo(2 * MINUTE_MS, 15 * MINUTE_MS))).toBe(15 * MINUTE_MS)
    expect(retryMs(failedAgo(10 * MINUTE_MS, HOUR_MS))).toBe(HOUR_MS)
  })

  it('never lets a queue retry exceed the cap, even after a parked day', () => {
    expect(retryMs(failedAgo(MINUTE_MS, 24 * HOUR_MS))).toBe(6 * HOUR_MS)
  })

  it('treats a failure recorded before its time was stored as the base interval, so the next wait is four times it', () => {
    const legacy: PreviousSnapshotFailure = {
      errorClass: 'provider_failure',
      failedAt: null,
      retryAt: before(MINUTE_MS),
    }
    expect(retryMs(legacy)).toBe(HOUR_MS)
  })

  it('treats a stored retry that is not after the failure as the base interval', () => {
    const odd: PreviousSnapshotFailure = {
      errorClass: 'provider_failure',
      failedAt: before(HOUR_MS),
      retryAt: before(2 * HOUR_MS),
    }
    expect(retryMs(odd)).toBe(HOUR_MS)
  })

  it('never waits less than the configured base when the base is above the cap', () => {
    // A discovery interval of 24 h: the first failure waits the base, so the
    // second must not shrink to the six-hour cap.
    const day = 24 * HOUR_MS
    expect(retryMs(null, { baseIntervalMs: day })).toBe(day)
    expect(retryMs(failedAgo(day + MINUTE_MS, day), { baseIntervalMs: day })).toBe(day)
    expect(retryMs(failedAgo(MINUTE_MS, day), { baseIntervalMs: day })).toBe(day)
  })

  it('treats a previous wait far above the cap (a stale failure time) as the cap', () => {
    // An old worker rewrote the retry date without the failure time, so the
    // stored gap is days long: the next wait is the cap, never longer.
    const stale: PreviousSnapshotFailure = {
      errorClass: 'provider_failure',
      failedAt: before(10 * 24 * HOUR_MS),
      retryAt: before(MINUTE_MS),
    }
    expect(retryMs(stale)).toBe(6 * HOUR_MS)
  })
})
