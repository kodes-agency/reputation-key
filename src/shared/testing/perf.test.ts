// BQC-8.1 — unit tests for the perf measurement library.
//
// Pure and hermetic: percentile math, summary aggregation, the bounded-
// concurrency probe runner (injected fake clock + monotonic now), and the
// raw-store JSON round-trip. No DB, no Redis, no wall-clock.

import { describe, it, expect } from 'vitest'
import {
  percentile,
  summarizeSamples,
  runProbes,
  serializeSamples,
  parseSamples,
  type PerfSample,
} from './perf'

const sample = (
  durationMs: number,
  ok = true,
  startedAt = '2026-07-31T00:00:00.000Z',
): PerfSample => ({
  name: 'probe',
  startedAt,
  durationMs,
  ok,
})

describe('percentile (linear interpolation between closest ranks)', () => {
  it('returns the single value for a one-element series', () => {
    expect(percentile([42], 50)).toBe(42)
    expect(percentile([42], 95)).toBe(42)
    expect(percentile([42], 99)).toBe(42)
  })

  it('interpolates between closest ranks', () => {
    // rank = p/100 * (n-1): p50 of [0,100] → rank 0.5 → 50
    expect(percentile([0, 100], 50)).toBe(50)
    // p95 of [0..9] → rank 8.55 → 8 + 0.55
    expect(percentile([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 95)).toBeCloseTo(8.55, 5)
    // p99 of [0..9] → rank 8.91 → 8.91
    expect(percentile([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 99)).toBeCloseTo(8.91, 5)
  })

  it('pins the ends of the series', () => {
    expect(percentile([10, 20, 30], 0)).toBe(10)
    expect(percentile([10, 20, 30], 100)).toBe(30)
  })

  it('throws on an empty series or out-of-range percentile', () => {
    expect(() => percentile([], 50)).toThrow(/empty/)
    expect(() => percentile([1], -1)).toThrow(/percentile/)
    expect(() => percentile([1], 101)).toThrow(/percentile/)
  })
})

describe('summarizeSamples', () => {
  it('aggregates counts, errors, percentiles, mean, max and rate', () => {
    const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((d, i) => sample(d, i !== 9))
    const summary = summarizeSamples(samples, 10_000)
    expect(summary.count).toBe(10)
    expect(summary.errors).toBe(1)
    expect(summary.mean).toBeCloseTo(5.5, 5)
    expect(summary.max).toBe(10)
    expect(summary.p50).toBeCloseTo(5.5, 5)
    expect(summary.ratePerSec).toBeCloseTo(1, 5) // 10 samples / 10s
  })

  it('reports zero rate for an empty window without inventing samples', () => {
    const summary = summarizeSamples([], 1000)
    expect(summary).toMatchObject({ count: 0, errors: 0, ratePerSec: 0 })
  })

  it('throws on a non-positive window (caller contract)', () => {
    expect(() => summarizeSamples([sample(1)], 0)).toThrow(/window/)
  })
})

describe('runProbes', () => {
  /** Deterministic virtual clock: now() and clock() share one counter. */
  function virtualTime(startMs = 1_000_000) {
    let t = startMs
    return {
      now: () => t,
      clock: () => new Date(1_752_435_200_000 + t - startMs),
      sleep: async (ms: number) => {
        t += ms
      },
      advance: (ms: number) => {
        t += ms
      },
    }
  }

  it('runs exactly count probes and collects a sample per probe', async () => {
    const vt = virtualTime()
    const samples = await runProbes({
      name: 'enqueue',
      count: 25,
      concurrency: 5,
      probe: async () => {
        vt.advance(3)
      },
      clock: vt.clock,
      now: vt.now,
      sleep: vt.sleep,
    })
    expect(samples).toHaveLength(25)
    expect(samples.every((s) => s.ok && s.name === 'enqueue')).toBe(true)
    // The workers share the virtual clock: under concurrency a sample's wall
    // latency includes sibling probes' advances, so ≥ the probe's own 3ms.
    expect(samples.every((s) => s.durationMs >= 3)).toBe(true)
  })

  it('records failures as ok:false samples instead of aborting the run', async () => {
    const vt = virtualTime()
    let i = 0
    const samples = await runProbes({
      name: 'read',
      count: 4,
      concurrency: 2,
      probe: async () => {
        i += 1
        if (i === 2) throw new Error('boom')
      },
      clock: vt.clock,
      now: vt.now,
      sleep: vt.sleep,
    })
    expect(samples).toHaveLength(4)
    expect(samples.filter((s) => !s.ok)).toHaveLength(1)
  })

  it('stops at the duration deadline', async () => {
    const vt = virtualTime()
    const samples = await runProbes({
      name: 'tick',
      durationMs: 1000,
      concurrency: 1,
      probe: async () => {
        vt.advance(100)
      },
      clock: vt.clock,
      now: vt.now,
      sleep: vt.sleep,
    })
    // 1000ms window, each probe consumes 100ms → exactly 10 probes.
    expect(samples).toHaveLength(10)
  })

  it('requires count or durationMs (fail-closed contract)', async () => {
    const vt = virtualTime()
    await expect(
      runProbes({
        name: 'bad',
        probe: async () => {},
        clock: vt.clock,
        now: vt.now,
        sleep: vt.sleep,
      }),
    ).rejects.toThrow(/count|durationMs/)
  })
})

describe('raw sample store round-trip', () => {
  it('serializes and parses back identical samples', () => {
    const samples = [sample(1), sample(2, false), sample(3)]
    const parsed = parseSamples(serializeSamples(samples))
    expect(parsed).toEqual(samples)
  })

  it('rejects malformed payloads (fail-closed raw store)', () => {
    expect(() => parseSamples('not json')).toThrow(SyntaxError)
    expect(() => parseSamples('{"version":1,"samples":"nope"}')).toThrow(/shape/)
    expect(() => parseSamples('{"version":1,"samples":[{"name":1}]}')).toThrow(/shape/)
    expect(() => parseSamples('{"version":2,"samples":[]}')).toThrow(/version/)
  })
})
