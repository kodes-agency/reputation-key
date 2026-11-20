// Unit tests for the discovery sweep's start-time spread (pure).

import { describe, it, expect } from 'vitest'
import { JOB_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'
import {
  DISCOVERY_SPREAD_WINDOW_MS,
  DISCOVERY_SWEEP_CADENCE_MS,
  discoverySpreadDelayMs,
  discoverySpreadWindowMs,
} from './discovery-spread'

const MINUTE = 60 * 1000

/**
 * Property ids are random UUIDs. A seeded generator keeps the distribution
 * checks deterministic while still looking like production ids.
 */
const uuidsFromSeed = (count: number, seed: number): string[] => {
  let state = seed >>> 0
  const nextHex = (digits: number): string => {
    let out = ''
    for (let i = 0; i < digits; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      out += (state >>> 28).toString(16)
    }
    return out
  }
  return Array.from(
    { length: count },
    () => `${nextHex(8)}-${nextHex(4)}-4${nextHex(3)}-8${nextHex(3)}-${nextHex(12)}`,
  )
}

/** One id, typed as a string (a destructured array read may be undefined). */
const uuidFromSeed = (seed: number): string => uuidsFromSeed(1, seed).join('')

describe('discoverySpreadDelayMs', () => {
  it('is deterministic: a property gets the same offset on every sweep', () => {
    const id = uuidFromSeed(7)

    expect(discoverySpreadDelayMs(id, DISCOVERY_SPREAD_WINDOW_MS)).toBe(
      discoverySpreadDelayMs(id, DISCOVERY_SPREAD_WINDOW_MS),
    )
  })

  it('stays inside the window: never negative, never the window itself', () => {
    for (const id of uuidsFromSeed(500, 11)) {
      const delay = discoverySpreadDelayMs(id, DISCOVERY_SPREAD_WINDOW_MS)

      expect(Number.isInteger(delay)).toBe(true)
      expect(delay).toBeGreaterThanOrEqual(0)
      expect(delay).toBeLessThan(DISCOVERY_SPREAD_WINDOW_MS)
    }
  })

  it('spreads a crowd across the whole window instead of clumping', () => {
    const delays = uuidsFromSeed(600, 23).map((id) =>
      discoverySpreadDelayMs(id, DISCOVERY_SPREAD_WINDOW_MS),
    )
    const perMinute = Array.from(
      { length: DISCOVERY_SPREAD_WINDOW_MS / MINUTE },
      (_, minute) =>
        delays.filter((delay) => Math.floor(delay / MINUTE) === minute).length,
    )

    // 600 properties over ten one-minute buckets average 60 each. Every
    // bucket is used and none carries more than twice its fair share.
    expect(perMinute.every((count) => count > 0)).toBe(true)
    expect(Math.max(...perMinute)).toBeLessThan(120)
  })

  it('gives a handful of properties distinct start offsets', () => {
    const delays = uuidsFromSeed(23, 5).map((id) =>
      discoverySpreadDelayMs(id, DISCOVERY_SPREAD_WINDOW_MS),
    )

    expect(new Set(delays).size).toBe(delays.length)
    // The first and last start are far apart: not all squeezed into one slice.
    expect(Math.max(...delays) - Math.min(...delays)).toBeGreaterThan(
      DISCOVERY_SPREAD_WINDOW_MS / 2,
    )
  })

  it('does not delay anything when there is no window', () => {
    const id = uuidFromSeed(3)

    expect(discoverySpreadDelayMs(id, 0)).toBe(0)
    expect(discoverySpreadDelayMs(id, -1)).toBe(0)
  })
})

describe('discoverySpreadWindowMs', () => {
  it('defaults to the named window on the default 15 minute base', () => {
    expect(discoverySpreadWindowMs(15 * MINUTE)).toBe(DISCOVERY_SPREAD_WINDOW_MS)
  })

  it('is strictly shorter than the sweep cadence, whatever is asked for', () => {
    expect(DISCOVERY_SPREAD_WINDOW_MS).toBeLessThan(DISCOVERY_SWEEP_CADENCE_MS)
    expect(discoverySpreadWindowMs(24 * 60 * MINUTE, 60 * MINUTE)).toBeLessThan(
      DISCOVERY_SWEEP_CADENCE_MS,
    )
  })

  it('is strictly shorter than a base interval the operator shortened', () => {
    for (const baseMinutes of [1, 2, 5, 10]) {
      expect(discoverySpreadWindowMs(baseMinutes * MINUTE)).toBeLessThan(
        baseMinutes * MINUTE,
      )
    }
  })

  it('never goes negative', () => {
    expect(discoverySpreadWindowMs(0)).toBe(0)
    expect(discoverySpreadWindowMs(15 * MINUTE, -5)).toBe(0)
  })
})

describe('the sweep cadence the window is measured against', () => {
  const sweepRow = JOB_FAMILY_ROWS.find((r) => r.jobName === 'discover-new-reviews')

  it('is the cadence the job catalogue actually schedules', () => {
    expect(sweepRow?.schedule).toBe(`every:${DISCOVERY_SWEEP_CADENCE_MS}`)
  })

  it('leaves room for a sweep that takes its whole timeout to enqueue its last property', () => {
    // A delay is counted from enqueue. The slowest legal sweep enqueues its
    // last job just before its timeout; that job still has to start before the
    // next sweep may enqueue the same property.
    expect(sweepRow?.timeoutMs).toBeDefined()
    expect((sweepRow?.timeoutMs ?? 0) + DISCOVERY_SPREAD_WINDOW_MS).toBeLessThanOrEqual(
      DISCOVERY_SWEEP_CADENCE_MS,
    )
  })
})
