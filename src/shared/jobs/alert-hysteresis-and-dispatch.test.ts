import { describe, it, expect, vi } from 'vitest'
import pino from 'pino'
import {
  QUARANTINE_NONEMPTY_ALERT_MS,
  type AlertEvent,
} from '#/shared/observability/alert-definitions'
import { evaluateAlerts } from '#/shared/observability/alert-evaluation'
import {
  createAlertDispatcher,
  type AlertDispatcher,
  type AlertFetchFn,
} from '#/shared/observability/alert-dispatcher'
import {
  createRedisAlertStateStore,
  ALERT_PENDING_KEY_PREFIX,
  ALERT_PENDING_TTL_SECONDS,
  ALERT_STATE_KEY_PREFIX,
  ALERT_STATE_TTL_SECONDS,
  type AlertStateStore,
} from '#/shared/health/alert-state'
import { isBannedLogKey } from '#/shared/observability/log-field-policy.test-fixtures'
import type { OperationsSnapshot } from '#/shared/health/operations-snapshot'
import {
  createHealthCheckHandler,
  type HealthCheckDeps,
} from '#/shared/jobs/health-check.job'

import {
  healthyAux,
  healthySnapshot,
  failedSyncSnapshot,
} from '#/shared/jobs/alert-injection.test-fixtures'

const OWNER = 'Bozhidar Denev'

// ── Hysteresis (edge-trigger + 24h re-notify + recovery) ───────────

describe('evaluateAlerts hysteresis', () => {
  it('fires on the ok→firing edge only while the state says firing', () => {
    const first = evaluateAlerts(failedSyncSnapshot(), healthyAux(), new Set(), new Set())
    expect(first.toDispatch.map((e) => e.name)).toEqual(['sync.failed-nonzero'])
    expect(first.firing).toEqual(['sync.failed-nonzero'])

    // Still breaching, state remembers firing — no re-dispatch.
    const second = evaluateAlerts(
      failedSyncSnapshot(),
      healthyAux(),
      new Set(first.firing),
      new Set(),
    )
    expect(second.toDispatch).toEqual([])
    expect(second.firing).toEqual(['sync.failed-nonzero'])
  })

  it('re-fires once the firing state has expired (24h re-notify)', () => {
    // The state store key expires after ALERT_STATE_TTL_SECONDS; the next
    // evaluation sees an empty previous state — a new edge.
    const again = evaluateAlerts(failedSyncSnapshot(), healthyAux(), new Set(), new Set())
    expect(again.toDispatch.map((e) => e.name)).toEqual(['sync.failed-nonzero'])
  })

  it('recovery removes the alert from the firing set (state cleared by the caller)', () => {
    const recovered = evaluateAlerts(
      healthySnapshot(),
      healthyAux(),
      new Set(['sync.failed-nonzero']),
      new Set(),
    )
    expect(recovered.toDispatch).toEqual([])
    expect(recovered.firing).toEqual([])
  })
})

// ── Firing-state store (Redis TTL semantics) ───────────────────────

describe('alert firing-state store', () => {
  function createFakeRedis() {
    const map = new Map<string, { value: string; exSeconds?: number }>()
    const sets: Array<{ key: string; exSeconds?: number }> = []
    return {
      sets,
      map,
      get: async (key: string) => map.get(key)?.value ?? null,
      set: async (key: string, value: string, mode: 'EX', seconds: number) => {
        expect(mode).toBe('EX')
        map.set(key, { value, exSeconds: seconds })
        sets.push({ key, exSeconds: seconds })
        return 'OK'
      },
      del: async (key: string) => {
        map.delete(key)
        return 1
      },
    }
  }

  it('marks firing with the 24h re-notify TTL under a content-free key', async () => {
    const redis = createFakeRedis()
    const store = createRedisAlertStateStore(redis)
    await store.markFiring('sync.failed-nonzero')

    expect(redis.sets).toEqual([
      {
        key: `${ALERT_STATE_KEY_PREFIX}sync.failed-nonzero`,
        exSeconds: ALERT_STATE_TTL_SECONDS,
      },
    ])
    expect(ALERT_STATE_TTL_SECONDS).toBe(24 * 60 * 60)
    expect(redis.map.get(`${ALERT_STATE_KEY_PREFIX}sync.failed-nonzero`)?.value).toBe(
      'firing',
    )
  })

  it('currentlyFiring reports only the names still holding state', async () => {
    const redis = createFakeRedis()
    const store = createRedisAlertStateStore(redis)
    await store.markFiring('sync.failed-nonzero')
    await store.markFiring('db.pool-exhaustion')

    const firing = await store.currentlyFiring([
      'sync.failed-nonzero',
      'db.pool-exhaustion',
      'queue.oldest-age',
    ])
    expect([...firing].sort()).toEqual(['db.pool-exhaustion', 'sync.failed-nonzero'])
  })

  it('re-fire after state expiry: an expired key reads as not firing', async () => {
    const redis = createFakeRedis()
    const store = createRedisAlertStateStore(redis)
    await store.markFiring('sync.failed-nonzero')
    // Redis expires the key after the TTL — simulate the expiry.
    redis.map.delete(`${ALERT_STATE_KEY_PREFIX}sync.failed-nonzero`)
    expect(await store.currentlyFiring(['sync.failed-nonzero'])).toEqual(new Set())
  })

  it('clearFiring removes the state (recovery)', async () => {
    const redis = createFakeRedis()
    const store = createRedisAlertStateStore(redis)
    await store.markFiring('sync.failed-nonzero')
    await store.clearFiring('sync.failed-nonzero')
    expect(await store.currentlyFiring(['sync.failed-nonzero'])).toEqual(new Set())
  })

  it('holds a pending breach only until the next evaluation is due', async () => {
    const redis = createFakeRedis()
    const store = createRedisAlertStateStore(redis)
    await store.markPending('observability.snapshot-degraded')

    expect(redis.sets).toEqual([
      {
        key: `${ALERT_PENDING_KEY_PREFIX}observability.snapshot-degraded`,
        exSeconds: ALERT_PENDING_TTL_SECONDS,
      },
    ])
    // Two 5-minute cadences: one missed evaluation breaks the streak.
    expect(ALERT_PENDING_TTL_SECONDS).toBe(10 * 60)
    expect(
      await store.currentlyPending([
        'observability.snapshot-degraded',
        'sync.failed-nonzero',
      ]),
    ).toEqual(new Set(['observability.snapshot-degraded']))
    // A pending breach is not a firing one.
    expect(await store.currentlyFiring(['observability.snapshot-degraded'])).toEqual(
      new Set(),
    )

    await store.clearPending('observability.snapshot-degraded')
    expect(await store.currentlyPending(['observability.snapshot-degraded'])).toEqual(
      new Set(),
    )
  })
})

// ── Dispatcher contract ────────────────────────────────────────────

describe('alert dispatcher', () => {
  const event: AlertEvent = {
    name: 'sync.failed-nonzero',
    severity: 'P2',
    owner: OWNER,
    runbook: 'runbooks.md §13',
    value: 2,
    threshold: 0,
    windowMs: 5 * 60 * 1000,
    detail: '2 Review sync(s) have a coded failure whose retry is due',
  }
  const clock = () => new Date('2026-07-31T12:00:00.000Z')

  function recordingLogger() {
    const logger = pino({ level: 'silent' })
    return { logger, error: vi.spyOn(logger, 'error'), warn: vi.spyOn(logger, 'warn') }
  }

  it('log-only mode (no webhook): one schema-conformant error line, no fetch', async () => {
    const { logger, error } = recordingLogger()
    const fetchFn = vi.fn<AlertFetchFn>()
    const dispatcher = createAlertDispatcher({ logger, clock, fetchFn })

    await dispatcher.dispatch(event)

    expect(error).toHaveBeenCalledOnce()
    const [fields, message] = error.mock.calls[0]!
    expect(String(message)).toContain('sync.failed-nonzero')
    expect(fields).toMatchObject({
      alert: 'sync.failed-nonzero',
      severity: 'P2',
      owner: OWNER,
      runbook: 'runbooks.md §13',
      value: 2,
      threshold: 0,
      windowMs: 5 * 60 * 1000,
      detail: '2 Review sync(s) have a coded failure whose retry is due',
      firedAt: '2026-07-31T12:00:00.000Z',
    })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('every dispatched field passes the 7.3 banned-key policy', async () => {
    const { logger, error } = recordingLogger()
    const dispatcher = createAlertDispatcher({ logger, clock })
    await dispatcher.dispatch(event)

    const fields = error.mock.calls[0]![0] as Record<string, unknown>
    for (const key of Object.keys(fields)) {
      expect(isBannedLogKey(key), `banned key: ${key}`).toBe(false)
    }
  })

  it('posts the same redacted payload to the operator webhook when configured', async () => {
    const { logger, error } = recordingLogger()
    const fetchFn = vi.fn<AlertFetchFn>(async () => ({ ok: true, status: 200 }))
    const dispatcher = createAlertDispatcher({
      logger,
      clock,
      webhookUrl: 'https://ops.example.test/alert-hook',
      fetchFn,
    })

    await dispatcher.dispatch(event)

    expect(fetchFn).toHaveBeenCalledOnce()
    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe('https://ops.example.test/alert-hook')
    expect(init?.method).toBe('POST')
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    const logged = error.mock.calls[0]![0] as Record<string, unknown>
    // The webhook payload IS the log payload — one redaction surface.
    expect(body).toEqual(logged)
    for (const key of Object.keys(body)) {
      expect(isBannedLogKey(key), `banned key: ${key}`).toBe(false)
    }
  })

  it('webhook failure warns and never throws into the evaluator path', async () => {
    const { logger, warn } = recordingLogger()
    const fetchFn = vi.fn<AlertFetchFn>(async () => {
      throw new Error('connection refused')
    })
    const dispatcher = createAlertDispatcher({
      logger,
      clock,
      webhookUrl: 'https://ops.example.test/alert-hook',
      fetchFn,
    })

    await expect(dispatcher.dispatch(event)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]![1])).toMatch(/webhook/i)
  })

  it('webhook non-2xx warns and never throws', async () => {
    const { logger, warn } = recordingLogger()
    const fetchFn = vi.fn<AlertFetchFn>(async () => ({ ok: false, status: 503 }))
    const dispatcher = createAlertDispatcher({
      logger,
      clock,
      webhookUrl: 'https://ops.example.test/alert-hook',
      fetchFn,
    })

    await expect(dispatcher.dispatch(event)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
  })
})

// ── Job-level wiring (health-check evaluation + hysteresis) ────────

describe('health-check job alert wiring', () => {
  function fakeStateStore() {
    const firing = new Set<string>()
    const pending = new Set<string>()
    const store: AlertStateStore = {
      currentlyFiring: async (names) =>
        new Set([...firing].filter((n) => names.includes(n))),
      markFiring: async (name) => {
        firing.add(name)
      },
      clearFiring: async (name) => {
        firing.delete(name)
      },
      currentlyPending: async (names) =>
        new Set([...pending].filter((n) => names.includes(n))),
      markPending: async (name) => {
        pending.add(name)
      },
      clearPending: async (name) => {
        pending.delete(name)
      },
    }
    return {
      store,
      expire: (name: string) => firing.delete(name),
      all: () => [...firing],
      pending: () => [...pending],
    }
  }

  function wiredDeps(
    snapshot: OperationsSnapshot,
    dispatcher?: HealthCheckDeps['alertDispatcher'],
  ) {
    const logger = pino({ level: 'silent' })
    const dispatched: AlertEvent[] = []
    const state = fakeStateStore()
    const readOperationsSnapshot = vi.fn(async () => snapshot)
    const deps: HealthCheckDeps = {
      dbHealthy: vi.fn(async () => true),
      redisHealthy: vi.fn(async () => true),
      logger,
      clock: () => new Date('2026-07-31T12:00:00.000Z'),
      readOperationsSnapshot,
      readAlertAux: vi.fn(async () => healthyAux()),
      alertState: state.store,
      alertDispatcher: dispatcher ?? {
        dispatch: vi.fn(async (event: AlertEvent) => {
          dispatched.push(event)
        }),
      },
    }
    return { deps, dispatched, state, logger, readOperationsSnapshot }
  }

  it('dispatches a breaching alert once, then not again while state holds', async () => {
    const { deps, dispatched } = wiredDeps(failedSyncSnapshot())
    const handler = createHealthCheckHandler(deps)

    await handler({ id: '1', data: {} } as never)
    expect(dispatched.map((e) => e.name)).toEqual(['sync.failed-nonzero'])

    await handler({ id: '2', data: {} } as never)
    expect(dispatched).toHaveLength(1) // no re-dispatch while firing
  })

  it('re-fires after the firing state expires (24h re-notify)', async () => {
    const { deps, dispatched, state } = wiredDeps(failedSyncSnapshot())
    const handler = createHealthCheckHandler(deps)

    await handler({ id: '1', data: {} } as never)
    await handler({ id: '2', data: {} } as never)
    expect(dispatched).toHaveLength(1)

    state.expire('sync.failed-nonzero') // Redis TTL elapsed
    await handler({ id: '3', data: {} } as never)
    expect(dispatched.map((e) => e.name)).toEqual([
      'sync.failed-nonzero',
      'sync.failed-nonzero',
    ])
  })

  it('clears the firing state on recovery so a later breach fires immediately', async () => {
    const { deps, dispatched, state, readOperationsSnapshot } =
      wiredDeps(failedSyncSnapshot())
    const handler = createHealthCheckHandler(deps)

    await handler({ id: '1', data: {} } as never)
    expect(state.all()).toEqual(['sync.failed-nonzero'])

    // Recovery: the breach is gone — state clears, nothing dispatches.
    readOperationsSnapshot.mockResolvedValue(healthySnapshot())
    await handler({ id: '2', data: {} } as never)
    expect(dispatched).toHaveLength(1)
    expect(state.all()).toEqual([])

    // A new breach after recovery is a new edge — dispatches again.
    readOperationsSnapshot.mockResolvedValue(failedSyncSnapshot())
    await handler({ id: '3', data: {} } as never)
    expect(dispatched).toHaveLength(2)
  })

  it('reports the firing/dispatched/held sets in the job result', async () => {
    const { deps } = wiredDeps(failedSyncSnapshot())
    const handler = createHealthCheckHandler(deps)
    const result = await handler({ id: '1', data: {} } as never)
    expect(result.alerts).toEqual({
      firing: ['sync.failed-nonzero'],
      dispatched: ['sync.failed-nonzero'],
      held: [],
      pending: [],
    })
  })

  it('holds a firing alert through its section degrading, then resumes without a second page', async () => {
    const quarantined = healthySnapshot()
    quarantined.quarantine = { count: 2, oldestAgeMs: QUARANTINE_NONEMPTY_ALERT_MS + 1 }
    const { deps, dispatched, state, readOperationsSnapshot } = wiredDeps(quarantined)
    const handler = createHealthCheckHandler(deps)

    await handler({ id: '1', data: {} } as never)
    expect(dispatched.map((e) => e.name)).toEqual(['queue.quarantine-nonempty'])

    // Queue Redis stalls: the quarantine signal degrades to its null fallback.
    const blind = healthySnapshot()
    blind.degraded = ['health.quarantine']
    readOperationsSnapshot.mockResolvedValue(blind)
    const heldRun = await handler({ id: '2', data: {} } as never)
    expect(heldRun.alerts?.held).toEqual([
      'queue.quarantine-growth',
      'queue.quarantine-nonempty',
    ])
    // One degraded evaluation is pending, not yet a page.
    expect(heldRun.alerts?.pending).toEqual(['observability.snapshot-degraded'])
    expect(state.pending()).toEqual(['observability.snapshot-degraded'])
    expect(dispatched.map((e) => e.name)).toEqual(['queue.quarantine-nonempty'])

    // Still blind on the next evaluation: now it pages.
    await handler({ id: '3', data: {} } as never)
    expect(state.all().sort()).toEqual([
      'observability.snapshot-degraded',
      'queue.quarantine-nonempty',
    ])
    expect(state.pending()).toEqual([])
    expect(dispatched.map((e) => e.name)).toEqual([
      'queue.quarantine-nonempty',
      'observability.snapshot-degraded',
    ])

    // The signal recovers and the dead letter is still there: same incident,
    // no second page; the degradation alert clears.
    readOperationsSnapshot.mockResolvedValue(quarantined)
    await handler({ id: '4', data: {} } as never)
    expect(dispatched).toHaveLength(2)
    expect(state.all()).toEqual(['queue.quarantine-nonempty'])
  })

  it('pages a degraded snapshot at once when its pending state cannot persist', async () => {
    const blind = healthySnapshot()
    blind.degraded = ['health.outbox']
    const { deps } = wiredDeps(blind)
    const dispatch = vi.fn<AlertDispatcher['dispatch']>(async () => {})
    const handler = createHealthCheckHandler({
      ...deps,
      alertState: undefined,
      alertDispatcher: { dispatch },
    })

    const result = await handler({ id: 'no-hysteresis', data: {} } as never)

    // Without a store no evaluation can confirm the next: fail visible.
    expect(result.alerts?.dispatched).toEqual(['observability.snapshot-degraded'])
  })

  it('a snapshot read failure warns and never breaks the health check', async () => {
    const { deps, logger, readOperationsSnapshot } = wiredDeps(healthySnapshot())
    const warn = vi.spyOn(logger, 'warn')
    readOperationsSnapshot.mockRejectedValue(new Error('db read failed'))
    const handler = createHealthCheckHandler(deps)
    const result = await handler({ id: '1', data: {} } as never)
    expect(result.db).toBe(true)
    expect(result.alerts).toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })

  it('a rejecting dispatcher never throws into the job', async () => {
    const { deps } = wiredDeps(failedSyncSnapshot(), {
      dispatch: vi.fn(async () => {
        throw new Error('webhook exploded')
      }),
    })
    const handler = createHealthCheckHandler(deps)
    const result = await handler({ id: '1', data: {} } as never)
    expect(result.db).toBe(true)
  })

  it('still dispatches Guest monitor degradation when Redis hysteresis state is unavailable', async () => {
    const snapshot = healthySnapshot()
    snapshot.guestObservationLoss = {
      ...snapshot.guestObservationLoss!,
      monitorAvailable: false,
    }
    const { deps } = wiredDeps(snapshot)
    const dispatch = vi.fn<AlertDispatcher['dispatch']>(async () => {})
    const unavailable = async (): Promise<never> => {
      throw new Error('cache redis unavailable with connection details')
    }
    const unavailableState: AlertStateStore = {
      currentlyFiring: unavailable,
      markFiring: unavailable,
      clearFiring: unavailable,
      currentlyPending: unavailable,
      markPending: unavailable,
      clearPending: unavailable,
    }
    const handler = createHealthCheckHandler({
      ...deps,
      alertState: unavailableState,
      alertDispatcher: { dispatch },
    })

    const result = await handler({ id: 'guest-monitor-degraded', data: {} } as never)

    expect(dispatch).toHaveBeenCalledOnce()
    expect(dispatch.mock.calls[0]![0]).toMatchObject({
      name: 'guest.observation-loss',
      value: 1,
    })
    expect(result.alerts).toEqual({
      firing: ['guest.observation-loss'],
      dispatched: ['guest.observation-loss'],
      held: [],
      pending: [],
    })
  })

  it('does not disable Guest degradation alerts when Cache Redis is absent at boot', async () => {
    const snapshot = healthySnapshot()
    snapshot.guestObservationLoss = {
      ...snapshot.guestObservationLoss!,
      monitorAvailable: false,
    }
    const { deps } = wiredDeps(snapshot)
    const dispatch = vi.fn<AlertDispatcher['dispatch']>(async () => {})
    const handler = createHealthCheckHandler({
      ...deps,
      alertState: undefined,
      alertDispatcher: { dispatch },
    })

    const result = await handler({ id: 'guest-monitor-absent', data: {} } as never)

    expect(dispatch).toHaveBeenCalledOnce()
    expect(dispatch.mock.calls[0]![0]).toMatchObject({
      name: 'guest.observation-loss',
      value: 1,
    })
    expect(result.alerts?.firing).toEqual(['guest.observation-loss'])
  })
})
