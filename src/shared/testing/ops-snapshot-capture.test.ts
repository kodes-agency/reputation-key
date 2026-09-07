// BQC-8.1 — unit tests for the ops-snapshot capture (monitoring time series).
//
// Hermetic: fake snapshot sources, virtual clock, manual ticks. The one
// real-timer test proves start()/stop() pacing. The content-free test pins
// the series projection to its whitelisted field set (ADR 0030).

import { describe, it, expect } from 'vitest'
import type { OperationsSnapshot } from '#/shared/health/operations-snapshot'
import {
  createCapture,
  toPoint,
  viaContainer,
  viaContainerFactory,
  viaHttp,
  serializeSeries,
  parseSeries,
  SNAPSHOT_SERIES_VERSION,
} from './ops-snapshot-capture'

const T0 = 1_752_435_200_000

function fakeSnapshot(overrides: Partial<OperationsSnapshot> = {}): OperationsSnapshot {
  return {
    timestamp: new Date(T0).toISOString(),
    outbox: {
      unpublishedCount: 3,
      oldestUnpublishedAgeMs: 1200,
      expiredLeaseCount: 0,
      claimedCount: 1,
      oldestClaimedAgeMs: 300,
      stalledLeaseCount: 0,
    },
    quarantine: { count: 2, oldestAgeMs: 5000 },
    reviews: {
      totalActive: 100,
      refreshDueCount: 4,
      expiredCount: 1,
      oldestDueAgeSeconds: 60,
    },
    sync: {
      dueForIncrementalCount: 2,
      failedSyncCount: 0,
      oldestDueAgeMs: null,
      gbpPushEnabled: false,
    },
    notifications: {
      emailDeliveryEnabled: false,
      pendingOverdueCount: 0,
      oldestPendingOverdueAgeMs: null,
      attemptedStuckCount: 0,
      missingForInboxItemCount: 0,
      deliveryLag: {
        sourceReceiptPending: 0,
        materializationPending: 0,
        oldestSourceRecordedAt: null,
        oldestSourceAgeMs: null,
        oldestMaterializationSourceRecordedAt: null,
        oldestMaterializationSourceAgeMs: null,
        oldestMaterializationEnqueuedAt: null,
        oldestMaterializationEnqueuedAgeMs: null,
        sourceSaturated: false,
        materializationSaturated: false,
        immediateEmailAcceptance: {
          awaitingProviderAcceptance: 0,
          attemptedAwaitingProviderAcceptance: 0,
          oldestAwaitingSourceRecordedAt: null,
          oldestAwaitingSourceAgeMs: null,
          acceptedLatencyP99Ms: null,
          acceptedSampleCount: 0,
          sourceUnlinked: 0,
          saturated: false,
        },
      },
    },
    replyPublication: {
      counts: {
        requested: 0,
        authorized: 0,
        sending: 0,
        published: 5,
        terminal: 0,
        ambiguous: 0,
        cancelled: 0,
      },
      oldestAmbiguousAgeMs: null,
    },
    workers: {
      defaultQueueName: 'default',
      backgroundQueueName: 'background',
      domainEventsQueueName: 'domain-events',
      heartbeat: { at: new Date(T0).toISOString(), ageMs: 1000, stale: false },
    },
    queues: [
      { name: 'default', waiting: 7, active: 2, delayed: 0, failed: 1, paused: 0 },
    ],
    db: {
      pool: { max: 10, totalCount: 4, idleCount: 3, waitingCount: 0 },
      migrationVersion: 17,
    },
    cache: { tenant: { hits: 9, misses: 1, evictions: 0, size: 8 } },
    release: { sha: 'abc123' },
    versions: {
      capabilityPolicy: 'cap-1',
      executionPolicy: 'exec-1',
      policyStore: 7,
      sourceContentPolicy: 3,
      runtime: 'v22.0.0',
    },
    degraded: [],
    ...overrides,
  }
}

const clockAt = (t: number) => () => new Date(T0 + t)

describe('toPoint projection', () => {
  it('keeps exactly the whitelisted SLO-relevant fields (incl. cache + reply publication, BQC-8.2)', () => {
    const point = toPoint(fakeSnapshot(), new Date(T0))
    expect(Object.keys(point).sort()).toEqual(
      [
        'at',
        'cache',
        'db',
        'degraded',
        'heartbeat',
        'outbox',
        'queues',
        'replyPublication',
        'reviews',
      ].sort(),
    )
    expect(point.outbox.unpublishedCount).toBe(3)
    expect(point.queues[0]).toMatchObject({ name: 'default', waiting: 7 })
    expect(point.db.pool?.totalCount).toBe(4)
    expect(point.cache.tenant).toMatchObject({ hits: 9, misses: 1 })
    expect(point.replyPublication.counts.published).toBe(5)
  })

  it('never serializes protected-content keys (ADR 0030 canary)', () => {
    const point = toPoint(fakeSnapshot(), new Date(T0))
    const json = JSON.stringify(point)
    for (const banned of ['text', 'reviewerName', 'email', 'token', 'locationName']) {
      expect(json).not.toContain(`"${banned}"`)
    }
  })
})

describe('viaContainer source', () => {
  it('delegates to the injected reader', async () => {
    const snapshot = fakeSnapshot()
    const source = viaContainer({ read: async () => snapshot })
    expect(await source.read()).toBe(snapshot)
  })
})

it('resolves the reader for every capture after an in-process restart', async () => {
  const first = fakeSnapshot({ release: { sha: 'before-restart' } })
  const second = fakeSnapshot({ release: { sha: 'after-restart' } })
  let current = { read: async () => first }
  const source = viaContainerFactory(() => current)

  expect(await source.read()).toBe(first)
  current = { read: async () => second }
  expect(await source.read()).toBe(second)
})

describe('viaHttp source', () => {
  it('GETs the metrics endpoint with the ops token header', async () => {
    const snapshot = fakeSnapshot()
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    const fetchImpl = (async (
      url: string | URL,
      init?: { headers?: Record<string, string> },
    ) => {
      calls.push({ url: String(url), headers: init?.headers ?? {} })
      return {
        ok: true,
        status: 200,
        json: async () => snapshot,
      } as Response
    }) as unknown as typeof fetch
    const source = viaHttp(
      'http://localhost:3000',
      'test-token-0123456789abcdef0123456789',
      fetchImpl,
    )
    expect(await source.read()).toEqual(snapshot)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://localhost:3000/api/health/metrics')
    expect(calls[0].headers['x-ops-token']).toBe('test-token-0123456789abcdef0123456789')
  })

  it('throws on a non-2xx response (a failed read is never silent)', async () => {
    const fetchImpl = async () =>
      ({ ok: false, status: 404, json: async () => ({}) }) as Response
    const source = viaHttp('http://localhost:3000', 'tok', fetchImpl)
    await expect(source.read()).rejects.toThrow(/404/)
  })
})

describe('createCapture', () => {
  it('collects one point per tick and records read errors separately', async () => {
    let calls = 0
    const source = {
      read: async () => {
        calls += 1
        if (calls === 2) throw new Error('db down')
        return fakeSnapshot()
      },
    }
    const capture = createCapture({ source, intervalMs: 1000, clock: clockAt(0) })
    await capture.tick()
    await capture.tick()
    await capture.tick()
    const series = await capture.stop()
    expect(series.points).toHaveLength(2)
    expect(series.readErrors).toHaveLength(1)
    expect(series.readErrors[0].message).toContain('db down')
    expect(series.intervalMs).toBe(1000)
    expect(series.stoppedAt).not.toBeNull()
  })

  it('skips overlapping ticks (a slow read never double-records)', async () => {
    let resolveRead: (s: OperationsSnapshot) => void = () => {}
    const source = {
      read: () =>
        new Promise<OperationsSnapshot>((resolve) => {
          resolveRead = resolve
        }),
    }
    const capture = createCapture({ source, intervalMs: 1000, clock: clockAt(0) })
    const first = capture.tick()
    const second = capture.tick() // must no-op while the first is in flight
    resolveRead(fakeSnapshot())
    await Promise.all([first, second])
    const series = await capture.stop()
    expect(series.points).toHaveLength(1)
  })

  it('start() paces ticks on the interval until stop()', async () => {
    const source = { read: async () => fakeSnapshot() }
    const capture = createCapture({ source, intervalMs: 10, clock: clockAt(0) })
    capture.start()
    await new Promise((resolve) => setTimeout(resolve, 45))
    const series = await capture.stop()
    expect(series.points.length).toBeGreaterThanOrEqual(2)
  })
})

describe('series raw-store round-trip', () => {
  it('serializes and parses back the identical series', async () => {
    const source = { read: async () => fakeSnapshot() }
    const capture = createCapture({ source, intervalMs: 500, clock: clockAt(0) })
    await capture.tick()
    const series = await capture.stop()
    const parsed = parseSeries(serializeSeries(series))
    expect(parsed).toEqual(series)
    expect(parsed.points).toHaveLength(1)
  })

  it('rejects malformed series payloads (fail closed)', () => {
    expect(() => parseSeries('nope')).toThrow(SyntaxError)
    expect(() => parseSeries('{"version":99,"points":[]}')).toThrow(/version/)
    expect(() =>
      parseSeries(
        JSON.stringify({ version: SNAPSHOT_SERIES_VERSION, points: [{ at: 1 }] }),
      ),
    ).toThrow(/shape/)
  })
})
