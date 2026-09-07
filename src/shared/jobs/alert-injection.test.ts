// BQC-7.4 — alert injection proof (unit level, synthetic fixtures).
//
// The phase doc requires: "Every alert must be injected at least once before
// BQC-8 acceptance." This suite is the synthetic injection for every alert
// whose signal source exists today: each implemented definition is evaluated
// against a breaching OperationsSnapshot/aux fixture (must fire with the
// pinned severity/owner/runbook/threshold/value) and against a healthy one
// (must stay quiet). The hysteresis contract (edge-trigger, 24h re-notify,
// recovery clears) and the dispatch contract (schema-conformant error log +
// optional operator webhook, never throwing into the evaluator) are pinned
// here too. One real-DB injection (stalled outbox lease through the REAL
// snapshot read) lives in infrastructure/repositories/alert-injection.test.ts.
//
// Alerts whose signal source lands in a later slice (web availability —
// external probe, BQC-8 staging; backup/PITR — BQC-7.8; security scan —
// BQC-7.7) are registered with owner/severity/runbook but evaluate: null;
// the registry test pins them as defined-but-not-implemented so they cannot
// silently pretend to fire.

import { describe, it, expect, vi } from 'vitest'
import pino from 'pino'
import {
  ALERT_DEFINITIONS,
  BETA_FEEDBACK_TRIAGE_BACKLOG_ALERT_MS,
  evaluateAlerts,
  OUTBOX_OLDEST_UNPUBLISHED_ALERT_MS,
  QUARANTINE_REDRIVE_SLA_ALERT_MS,
  QUARANTINE_NONEMPTY_ALERT_MS,
  SYNC_SWEEP_LAG_ALERT_MS,
  NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS,
  NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS,
  NOTIFICATION_EMAIL_STALLED_ALERT_MS,
  WORKER_HEARTBEAT_STALE_ALERT_MS,
  SOURCE_FRESHNESS_DEADLINE_ALERT_SECONDS,
  REPLY_AMBIGUOUS_ALERT_MS,
  type AlertAuxReads,
  type AlertEvent,
} from '#/shared/observability/alert-definitions'
import {
  createAlertDispatcher,
  type AlertDispatcher,
  type AlertFetchFn,
} from '#/shared/observability/alert-dispatcher'
import {
  createRedisAlertStateStore,
  ALERT_STATE_KEY_PREFIX,
  ALERT_STATE_TTL_SECONDS,
  type AlertStateStore,
} from '#/shared/health/alert-state'
import { isBannedLogKey } from '#/shared/observability/metrics-schema'
import type { OperationsSnapshot } from '#/shared/health/operations-snapshot'
import {
  createHealthCheckHandler,
  type HealthCheckDeps,
} from '#/shared/jobs/health-check.job'

// ── Fixtures ───────────────────────────────────────────────────────

/** Deep-mutable view for fixture mutation (the production types are Readonly). */
type DeepMutable<T> = {
  -readonly [K in keyof T]: T[K] extends object ? DeepMutable<T[K]> : T[K]
}

type MutableSnapshot = DeepMutable<OperationsSnapshot>
type MutableAux = DeepMutable<AlertAuxReads>

/** A fully healthy operations snapshot — every implemented alert quiet. */
function healthySnapshot(): MutableSnapshot {
  return {
    timestamp: '2026-07-31T00:00:00.000Z',
    outbox: {
      unpublishedCount: 0,
      oldestUnpublishedAgeMs: null,
      expiredLeaseCount: 0,
      claimedCount: 0,
      oldestClaimedAgeMs: null,
      stalledLeaseCount: 0,
    },
    quarantine: null,
    // From here down this healthy OperationsSnapshot repeats the baseline in
    // observability/alert-definitions.test.ts. An alert test's whole contract
    // is WHICH snapshot values trip a threshold, so the baseline it perturbs
    // has to be readable beside the assertion that reads it.
    // One shared fixture would mean retuning the baseline for one alert
    // silently changes the input of every other alert's test — and the two
    // baselines already differ on purpose (quarantine, timestamps,
    // migrationVersion, degraded).
    // Revisit if a third consumer appears, or if the snapshot SHAPE (not its
    // values) starts drifting from OperationsSnapshot.
    // fallow-ignore-next-line code-duplication
    reviews: {
      totalActive: 10,
      refreshDueCount: 0,
      expiredCount: 0,
      oldestDueAgeSeconds: null,
    },
    sync: {
      dueForIncrementalCount: 0,
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
        published: 3,
        terminal: 1,
        ambiguous: 0,
        cancelled: 0,
      },
      oldestAmbiguousAgeMs: null,
    },
    queues: [],
    workers: {
      defaultQueueName: 'default',
      backgroundQueueName: 'background',
      domainEventsQueueName: 'domain-events',
      heartbeat: { at: '2026-07-31T00:00:00.000Z', ageMs: 60_000, stale: false },
    },
    db: {
      pool: { max: 10, totalCount: 3, idleCount: 3, waitingCount: 0 },
      migrationVersion: 17,
    },
    cache: { tenant: { hits: 1, misses: 0, evictions: 0, size: 1 } },
    release: { sha: 'abc1234' },
    versions: {
      capabilityPolicy: 'test',
      executionPolicy: 'test-exec',
      policyStore: 1,
      sourceContentPolicy: 1,
      runtime: 'v22.0.0',
    },
    jobs: {
      ready: true,
      total: 0,
      active: 0,
      dark: 0,
      quarantined: 0,
      failing: 0,
      missingObservations: 0,
      handlerMissing: 0,
      schedulerMissing: 0,
      forbiddenDarkWork: 0,
      quarantinedSchedulers: 0,
      missedObjectives: 0,
      queueAgeMissed: 0,
      stalled: 0,
      repairRequired: 0,
      deadLetters: 0,
      rows: [],
    },
    guestObservationLoss: {
      monitorAvailable: true,
      windowMs: 24 * 60 * 60 * 1000,
      precisionMs: 5 * 60 * 1000,
      scanLossCount: 0,
      reviewLinkLossCount: 0,
      ratingLossCount: 0,
      totalLossCount: 0,
      ratingDisposition: 'not_applicable_durable',
    },
    degraded: [],
  }
}

function healthyAux(): MutableAux {
  return {
    retentionFailedSubjects: [],
    betaFeedbackTriage: {
      monitorAvailable: true,
      deliveredUnresolvedCount: 0,
      oldestDeliveredUnresolvedAgeMs: null,
    },
  }
}

// ── Registry contract ──────────────────────────────────────────────

describe('alert registry contract (BQC-7.4)', () => {
  it('registers exactly the phase-doc alert set', () => {
    expect(ALERT_DEFINITIONS.map((d) => d.name).sort()).toEqual([
      'backup.pitr',
      'beta-feedback.triage-backlog',
      'db.pool-exhaustion',
      'guest.observation-loss',
      'notification.email-stalled',
      'notification.immediate-email-acceptance-lag',
      'notification.in-app-delivery-lag',
      'notification.missing-for-inbox-item',
      'queue.oldest-age',
      'queue.quarantine-growth',
      'queue.quarantine-nonempty',
      'queue.stalled',
      'reply.ambiguous-aging',
      'retention.failure',
      'security.scan',
      'source.freshness-deadline',
      'sync.failed-nonzero',
      'sync.sweep-lag',
      'web.availability',
      'worker.heartbeat.stale',
      'worker.job-runtime-unready',
    ])
  })

  it('every definition carries owner, severity, threshold, window, and runbook', () => {
    for (const def of ALERT_DEFINITIONS) {
      expect(def.owner.length, def.name).toBeGreaterThan(0)
      expect(['P0', 'P1', 'P2', 'P3'], def.name).toContain(def.severity)
      expect(def.threshold, def.name).toBeGreaterThanOrEqual(0)
      expect(def.windowMs, def.name).toBeGreaterThan(0)
      expect(def.runbook, def.name).toMatch(/^runbooks\.md §\d+$/)
    }
  })

  it('implemented definitions have a pure evaluate; the externally-signalled ones do not', () => {
    const unimplemented = ALERT_DEFINITIONS.filter((d) => !d.implemented).map(
      (d) => d.name,
    )
    // Deliberate dispositions, NOT pending work: backup.pitr's signal is the
    // platform backup schedule + the BQC-8 timed restore drill (BQC-7.8 —
    // platform backup status is not app-readable); security.scan's is the CI
    // hard-gate chain (BQC-7.7); web.availability's is the BQC-8 external
    // synthetic probe. The phase-doc injection requirement is satisfied by
    // that external evidence — these must NEVER gain an app-level evaluate.
    expect(unimplemented.sort()).toEqual([
      'backup.pitr',
      'security.scan',
      'web.availability',
    ])
    for (const def of ALERT_DEFINITIONS) {
      if (def.implemented) expect(typeof def.evaluate, def.name).toBe('function')
      else expect(def.evaluate, def.name).toBeNull()
    }
  })
})

// ── Per-alert injection table ──────────────────────────────────────

type Breach = Readonly<{
  name: string
  severity: 'P0' | 'P1' | 'P2' | 'P3'
  runbook: string
  threshold: number
  windowMs: number
  /** Expected event value for the injected breach. */
  value: number
  apply: (snapshot: MutableSnapshot, aux: MutableAux) => void
}>

const OWNER = 'Bozhidar Denev'

/** The injection table — one breaching mutation per implemented alert. */
const BREACHES: readonly Breach[] = [
  {
    name: 'guest.observation-loss',
    severity: 'P1',
    runbook: 'runbooks.md §18',
    threshold: 0,
    windowMs: 24 * 60 * 60 * 1000,
    value: 1,
    apply: (s) => {
      s.guestObservationLoss = {
        ...s.guestObservationLoss!,
        reviewLinkLossCount: 1,
        totalLossCount: 1,
      }
    },
  },
  {
    name: 'worker.heartbeat.stale',
    severity: 'P1',
    runbook: 'runbooks.md §7',
    threshold: WORKER_HEARTBEAT_STALE_ALERT_MS,
    windowMs: WORKER_HEARTBEAT_STALE_ALERT_MS,
    value: -1, // heartbeat missing entirely
    apply: (s) => {
      s.workers.heartbeat = { at: null, ageMs: null, stale: true }
    },
  },
  {
    name: 'worker.job-runtime-unready',
    severity: 'P1',
    runbook: 'runbooks.md §17',
    threshold: 0,
    windowMs: 5 * 60 * 1000,
    value: 2,
    apply: (s) => {
      s.jobs = {
        ...s.jobs!,
        ready: false,
        total: 2,
        active: 2,
        failing: 2,
        handlerMissing: 1,
        repairRequired: 1,
      }
    },
  },
  {
    name: 'queue.oldest-age',
    severity: 'P2',
    runbook: 'runbooks.md §7',
    threshold: OUTBOX_OLDEST_UNPUBLISHED_ALERT_MS,
    windowMs: OUTBOX_OLDEST_UNPUBLISHED_ALERT_MS,
    value: 16 * 60 * 1000,
    apply: (s) => {
      s.outbox = {
        ...s.outbox,
        unpublishedCount: 4,
        oldestUnpublishedAgeMs: 16 * 60 * 1000,
      }
    },
  },
  {
    name: 'queue.stalled',
    severity: 'P2',
    runbook: 'runbooks.md §7',
    threshold: 0,
    windowMs: 5 * 60 * 1000,
    value: 2,
    apply: (s) => {
      s.outbox = { ...s.outbox, stalledLeaseCount: 2 }
    },
  },
  {
    name: 'queue.quarantine-growth',
    severity: 'P2',
    runbook: 'runbooks.md §4',
    threshold: QUARANTINE_REDRIVE_SLA_ALERT_MS,
    windowMs: QUARANTINE_REDRIVE_SLA_ALERT_MS,
    value: 25 * 60 * 60 * 1000,
    apply: (s) => {
      s.quarantine = { count: 1, oldestAgeMs: 25 * 60 * 60 * 1000 }
    },
  },
  {
    name: 'queue.quarantine-nonempty',
    severity: 'P1',
    runbook: 'runbooks.md §14',
    threshold: QUARANTINE_NONEMPTY_ALERT_MS,
    windowMs: QUARANTINE_NONEMPTY_ALERT_MS,
    value: 20 * 60 * 1000,
    apply: (s) => {
      // Deliberately under the 24h SLA so this injection does not also trip
      // queue.quarantine-growth — the two alerts must be separable.
      s.quarantine = { count: 2, oldestAgeMs: 20 * 60 * 1000 }
    },
  },
  {
    name: 'sync.failed-nonzero',
    severity: 'P2',
    runbook: 'runbooks.md §13',
    threshold: 0,
    windowMs: 5 * 60 * 1000,
    value: 2,
    apply: (s) => {
      s.sync = { ...s.sync, failedSyncCount: 2 }
    },
  },
  {
    name: 'sync.sweep-lag',
    severity: 'P1',
    runbook: 'runbooks.md §13',
    threshold: SYNC_SWEEP_LAG_ALERT_MS,
    windowMs: SYNC_SWEEP_LAG_ALERT_MS,
    value: 61 * 60 * 1000,
    apply: (s) => {
      s.sync = {
        ...s.sync,
        dueForIncrementalCount: 5,
        oldestDueAgeMs: 61 * 60 * 1000,
      }
    },
  },
  {
    name: 'notification.missing-for-inbox-item',
    severity: 'P1',
    runbook: 'runbooks.md §15',
    threshold: 0,
    windowMs: 5 * 60 * 1000,
    value: 3,
    apply: (s) => {
      s.notifications = { ...s.notifications, missingForInboxItemCount: 3 }
    },
  },
  {
    name: 'notification.in-app-delivery-lag',
    severity: 'P1',
    runbook: 'runbooks.md §15',
    threshold: NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS,
    windowMs: NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS,
    value: NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS + 1,
    apply: (s) => {
      s.notifications = {
        ...s.notifications,
        deliveryLag: {
          ...s.notifications.deliveryLag,
          sourceReceiptPending: 1,
          oldestSourceRecordedAt: '2026-07-30T23:58:59.999Z',
          oldestSourceAgeMs: NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS + 1,
        },
      }
    },
  },
  {
    name: 'notification.immediate-email-acceptance-lag',
    severity: 'P2',
    runbook: 'runbooks.md §15',
    threshold: NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS,
    windowMs: NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS,
    value: NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS + 1,
    apply: (s) => {
      s.notifications = {
        ...s.notifications,
        deliveryLag: {
          ...s.notifications.deliveryLag,
          immediateEmailAcceptance: {
            ...s.notifications.deliveryLag.immediateEmailAcceptance,
            acceptedLatencyP99Ms: NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS + 1,
            acceptedSampleCount: 100,
          },
        },
      }
    },
  },
  {
    name: 'notification.email-stalled',
    severity: 'P2',
    runbook: 'runbooks.md §15',
    threshold: NOTIFICATION_EMAIL_STALLED_ALERT_MS,
    windowMs: NOTIFICATION_EMAIL_STALLED_ALERT_MS,
    value: 3 * 60 * 60 * 1000,
    apply: (s) => {
      s.notifications = {
        ...s.notifications,
        emailDeliveryEnabled: true,
        pendingOverdueCount: 4,
        oldestPendingOverdueAgeMs: 3 * 60 * 60 * 1000,
      }
    },
  },
  {
    name: 'source.freshness-deadline',
    severity: 'P1',
    runbook: 'runbooks.md §3',
    threshold: SOURCE_FRESHNESS_DEADLINE_ALERT_SECONDS,
    windowMs: SOURCE_FRESHNESS_DEADLINE_ALERT_SECONDS * 1000,
    value: 100_000, // seconds until the nearest hard expiry — below the 2d mark
    apply: (s) => {
      s.reviews = { ...s.reviews, refreshDueCount: 3, oldestDueAgeSeconds: 100_000 }
    },
  },
  {
    name: 'beta-feedback.triage-backlog',
    severity: 'P2',
    runbook: 'runbooks.md §16',
    threshold: BETA_FEEDBACK_TRIAGE_BACKLOG_ALERT_MS,
    windowMs: BETA_FEEDBACK_TRIAGE_BACKLOG_ALERT_MS,
    value: BETA_FEEDBACK_TRIAGE_BACKLOG_ALERT_MS + 1,
    apply: (_s, aux) => {
      aux.betaFeedbackTriage = {
        monitorAvailable: true,
        deliveredUnresolvedCount: 2,
        oldestDeliveredUnresolvedAgeMs: BETA_FEEDBACK_TRIAGE_BACKLOG_ALERT_MS + 1,
      }
    },
  },
  {
    name: 'retention.failure',
    severity: 'P1',
    runbook: 'runbooks.md §8',
    threshold: 0,
    windowMs: 24 * 60 * 60 * 1000,
    value: 1,
    apply: (_s, aux) => {
      aux.retentionFailedSubjects = ['reviews.purge']
    },
  },
  {
    name: 'reply.ambiguous-aging',
    severity: 'P2',
    runbook: 'runbooks.md §6',
    threshold: REPLY_AMBIGUOUS_ALERT_MS,
    windowMs: REPLY_AMBIGUOUS_ALERT_MS,
    value: 20 * 60 * 1000,
    apply: (s) => {
      s.replyPublication = {
        counts: { ...s.replyPublication.counts, ambiguous: 1 },
        oldestAmbiguousAgeMs: 20 * 60 * 1000,
      }
    },
  },
  {
    name: 'db.pool-exhaustion',
    severity: 'P1',
    runbook: 'runbooks.md §8',
    threshold: 0,
    windowMs: 5 * 60 * 1000,
    value: 2,
    apply: (s) => {
      s.db = {
        ...s.db,
        pool: { max: 10, totalCount: 10, idleCount: 0, waitingCount: 2 },
      }
    },
  },
]

describe('per-alert synthetic injection (fire / no-fire)', () => {
  it('every implemented alert has an injection case', () => {
    const implemented = ALERT_DEFINITIONS.filter((d) => d.implemented).map((d) => d.name)
    expect(BREACHES.map((b) => b.name).sort()).toEqual(implemented.sort())
  })

  for (const breach of BREACHES) {
    it(`${breach.name} fires on the breaching fixture with its pinned identity`, () => {
      const snapshot = healthySnapshot()
      const aux = healthyAux()
      breach.apply(snapshot, aux)

      const { toDispatch, firing } = evaluateAlerts(snapshot, aux, new Set())
      const event = toDispatch.find((e) => e.name === breach.name)

      expect(event, `${breach.name} must dispatch`).toBeDefined()
      expect(event).toMatchObject({
        name: breach.name,
        severity: breach.severity,
        owner: OWNER,
        runbook: breach.runbook,
        threshold: breach.threshold,
        windowMs: breach.windowMs,
        value: breach.value,
      })
      expect(typeof event!.detail).toBe('string')
      expect(event!.detail.length).toBeGreaterThan(0)
      expect(firing).toContain(breach.name)
    })

    it(`${breach.name} does not fire on the healthy fixture`, () => {
      const { toDispatch, firing } = evaluateAlerts(
        healthySnapshot(),
        healthyAux(),
        new Set(),
      )
      expect(toDispatch.map((e) => e.name)).not.toContain(breach.name)
      expect(firing).not.toContain(breach.name)
    })
  }

  it('healthy fixture dispatches nothing at all', () => {
    const { toDispatch, firing } = evaluateAlerts(
      healthySnapshot(),
      healthyAux(),
      new Set(),
    )
    expect(toDispatch).toEqual([])
    expect(firing).toEqual([])
  })
})

describe('threshold boundaries', () => {
  const at = (name: string) => ALERT_DEFINITIONS.find((d) => d.name === name)!

  it('age thresholds are exclusive (== threshold does not fire)', () => {
    const snapshot = healthySnapshot()
    snapshot.outbox = {
      ...snapshot.outbox,
      unpublishedCount: 1,
      oldestUnpublishedAgeMs: OUTBOX_OLDEST_UNPUBLISHED_ALERT_MS,
    }
    expect(at('queue.oldest-age').evaluate!(snapshot, healthyAux())).toBeNull()
  })

  it('worker heartbeat at the staleness boundary does not fire', () => {
    const snapshot = healthySnapshot()
    snapshot.workers.heartbeat = {
      at: 'x',
      ageMs: WORKER_HEARTBEAT_STALE_ALERT_MS,
      stale: false,
    }
    expect(at('worker.heartbeat.stale').evaluate!(snapshot, healthyAux())).toBeNull()
  })

  it('source freshness fires only when refresh is due AND inside the deadline mark', () => {
    const snapshot = healthySnapshot()
    // At the boundary exactly — not yet inside the alert window.
    snapshot.reviews = {
      ...snapshot.reviews,
      refreshDueCount: 2,
      oldestDueAgeSeconds: SOURCE_FRESHNESS_DEADLINE_ALERT_SECONDS,
    }
    expect(at('source.freshness-deadline').evaluate!(snapshot, healthyAux())).toBeNull()
    // Inside the window but nothing refresh-due — no row is actually at risk.
    snapshot.reviews = {
      ...snapshot.reviews,
      refreshDueCount: 0,
      oldestDueAgeSeconds: 60_000,
    }
    expect(at('source.freshness-deadline').evaluate!(snapshot, healthyAux())).toBeNull()
  })

  it('quarantine-growth needs an AGED quarantine row (young backlog does not fire)', () => {
    const snapshot = healthySnapshot()
    snapshot.quarantine = { count: 3, oldestAgeMs: 60 * 1000 }
    expect(at('queue.quarantine-growth').evaluate!(snapshot, healthyAux())).toBeNull()
  })


  it('reply.ambiguous-aging needs an aged ambiguous row (count alone does not fire)', () => {
    const snapshot = healthySnapshot()
    snapshot.replyPublication = {
      counts: { ...snapshot.replyPublication.counts, ambiguous: 2 },
      oldestAmbiguousAgeMs: null, // none past reconcile_due yet
    }
    expect(at('reply.ambiguous-aging').evaluate!(snapshot, healthyAux())).toBeNull()
  })

  it('db.pool-exhaustion tolerates a null pool (section degraded)', () => {
    const snapshot = healthySnapshot()
    snapshot.db = { pool: null, migrationVersion: null }
    expect(at('db.pool-exhaustion').evaluate!(snapshot, healthyAux())).toBeNull()
  })
})

// ── Hysteresis (edge-trigger + 24h re-notify + recovery) ───────────

describe('evaluateAlerts hysteresis', () => {
  function stalledSnapshot(): MutableSnapshot {
    const s = healthySnapshot()
    s.outbox = { ...s.outbox, stalledLeaseCount: 1 }
    return s
  }

  it('fires on the ok→firing edge only while the state says firing', () => {
    const first = evaluateAlerts(stalledSnapshot(), healthyAux(), new Set())
    expect(first.toDispatch.map((e) => e.name)).toEqual(['queue.stalled'])
    expect(first.firing).toEqual(['queue.stalled'])

    // Still breaching, state remembers firing — no re-dispatch.
    const second = evaluateAlerts(stalledSnapshot(), healthyAux(), new Set(first.firing))
    expect(second.toDispatch).toEqual([])
    expect(second.firing).toEqual(['queue.stalled'])
  })

  it('re-fires once the firing state has expired (24h re-notify)', () => {
    // The state store key expires after ALERT_STATE_TTL_SECONDS; the next
    // evaluation sees an empty previous state — a new edge.
    const again = evaluateAlerts(stalledSnapshot(), healthyAux(), new Set())
    expect(again.toDispatch.map((e) => e.name)).toEqual(['queue.stalled'])
  })

  it('recovery removes the alert from the firing set (state cleared by the caller)', () => {
    const recovered = evaluateAlerts(
      healthySnapshot(),
      healthyAux(),
      new Set(['queue.stalled']),
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
    await store.markFiring('queue.stalled')

    expect(redis.sets).toEqual([
      {
        key: `${ALERT_STATE_KEY_PREFIX}queue.stalled`,
        exSeconds: ALERT_STATE_TTL_SECONDS,
      },
    ])
    expect(ALERT_STATE_TTL_SECONDS).toBe(24 * 60 * 60)
    expect(redis.map.get(`${ALERT_STATE_KEY_PREFIX}queue.stalled`)?.value).toBe('firing')
  })

  it('currentlyFiring reports only the names still holding state', async () => {
    const redis = createFakeRedis()
    const store = createRedisAlertStateStore(redis)
    await store.markFiring('queue.stalled')
    await store.markFiring('db.pool-exhaustion')

    const firing = await store.currentlyFiring([
      'queue.stalled',
      'db.pool-exhaustion',
      'queue.oldest-age',
    ])
    expect([...firing].sort()).toEqual(['db.pool-exhaustion', 'queue.stalled'])
  })

  it('re-fire after state expiry: an expired key reads as not firing', async () => {
    const redis = createFakeRedis()
    const store = createRedisAlertStateStore(redis)
    await store.markFiring('queue.stalled')
    // Redis expires the key after the TTL — simulate the expiry.
    redis.map.delete(`${ALERT_STATE_KEY_PREFIX}queue.stalled`)
    expect(await store.currentlyFiring(['queue.stalled'])).toEqual(new Set())
  })

  it('clearFiring removes the state (recovery)', async () => {
    const redis = createFakeRedis()
    const store = createRedisAlertStateStore(redis)
    await store.markFiring('queue.stalled')
    await store.clearFiring('queue.stalled')
    expect(await store.currentlyFiring(['queue.stalled'])).toEqual(new Set())
  })
})

// ── Dispatcher contract ────────────────────────────────────────────

describe('alert dispatcher', () => {
  const event: AlertEvent = {
    name: 'queue.stalled',
    severity: 'P2',
    owner: OWNER,
    runbook: 'runbooks.md §7',
    value: 2,
    threshold: 0,
    windowMs: 5 * 60 * 1000,
    detail: '2 stalled outbox lease(s)',
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
    expect(String(message)).toContain('queue.stalled')
    expect(fields).toMatchObject({
      alert: 'queue.stalled',
      severity: 'P2',
      owner: OWNER,
      runbook: 'runbooks.md §7',
      value: 2,
      threshold: 0,
      windowMs: 5 * 60 * 1000,
      detail: '2 stalled outbox lease(s)',
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
    const store: AlertStateStore = {
      currentlyFiring: async (names) =>
        new Set([...firing].filter((n) => names.includes(n))),
      markFiring: async (name) => {
        firing.add(name)
      },
      clearFiring: async (name) => {
        firing.delete(name)
      },
    }
    return {
      store,
      expire: (name: string) => firing.delete(name),
      all: () => [...firing],
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

  function stalledSnapshot(): MutableSnapshot {
    const s = healthySnapshot()
    s.outbox = { ...s.outbox, stalledLeaseCount: 1 }
    return s
  }

  it('dispatches a breaching alert once, then not again while state holds', async () => {
    const { deps, dispatched } = wiredDeps(stalledSnapshot())
    const handler = createHealthCheckHandler(deps)

    await handler({ id: '1', data: {} } as never)
    expect(dispatched.map((e) => e.name)).toEqual(['queue.stalled'])

    await handler({ id: '2', data: {} } as never)
    expect(dispatched).toHaveLength(1) // no re-dispatch while firing
  })

  it('re-fires after the firing state expires (24h re-notify)', async () => {
    const { deps, dispatched, state } = wiredDeps(stalledSnapshot())
    const handler = createHealthCheckHandler(deps)

    await handler({ id: '1', data: {} } as never)
    await handler({ id: '2', data: {} } as never)
    expect(dispatched).toHaveLength(1)

    state.expire('queue.stalled') // Redis TTL elapsed
    await handler({ id: '3', data: {} } as never)
    expect(dispatched.map((e) => e.name)).toEqual(['queue.stalled', 'queue.stalled'])
  })

  it('clears the firing state on recovery so a later breach fires immediately', async () => {
    const { deps, dispatched, state, readOperationsSnapshot } =
      wiredDeps(stalledSnapshot())
    const handler = createHealthCheckHandler(deps)

    await handler({ id: '1', data: {} } as never)
    expect(state.all()).toEqual(['queue.stalled'])

    // Recovery: the breach is gone — state clears, nothing dispatches.
    readOperationsSnapshot.mockResolvedValue(healthySnapshot())
    await handler({ id: '2', data: {} } as never)
    expect(dispatched).toHaveLength(1)
    expect(state.all()).toEqual([])

    // A new breach after recovery is a new edge — dispatches again.
    readOperationsSnapshot.mockResolvedValue(stalledSnapshot())
    await handler({ id: '3', data: {} } as never)
    expect(dispatched).toHaveLength(2)
  })

  it('reports the firing/dispatched sets in the job result', async () => {
    const { deps } = wiredDeps(stalledSnapshot())
    const handler = createHealthCheckHandler(deps)
    const result = await handler({ id: '1', data: {} } as never)
    expect(result.alerts).toEqual({
      firing: ['queue.stalled'],
      dispatched: ['queue.stalled'],
    })
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
    const { deps } = wiredDeps(stalledSnapshot(), {
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
    const unavailableState: AlertStateStore = {
      currentlyFiring: async () => {
        throw new Error('cache redis unavailable with connection details')
      },
      markFiring: async () => {
        throw new Error('cache redis unavailable with connection details')
      },
      clearFiring: async () => {
        throw new Error('cache redis unavailable with connection details')
      },
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
