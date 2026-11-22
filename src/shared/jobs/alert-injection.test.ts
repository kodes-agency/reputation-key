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

import { describe, it, expect } from 'vitest'
import {
  ALERT_DEFINITIONS,
  OUTBOX_OLDEST_UNPUBLISHED_ALERT_MS,
  QUARANTINE_REDRIVE_SLA_ALERT_MS,
  QUARANTINE_NONEMPTY_ALERT_MS,
  SYNC_SWEEP_LAG_ALERT_MS,
  NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS,
  NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS,
  NOTIFICATION_EMAIL_STALLED_ALERT_MS,
  NOTIFICATION_EMAIL_BOUNCE_RATE_ALERT_PERCENT,
  NOTIFICATION_EMAIL_OUTCOME_WINDOW_MS,
  NOTIFICATION_EMAIL_PERMANENT_FAILURE_SHARE_ALERT_PERCENT,
  NOTIFICATION_EMAIL_UNRESOLVED_ALERT_COUNT,
  NOTIFICATION_EMAIL_UNRESOLVED_LOOKBACK_MS,
  REVIEW_ANALYSIS_STALLED_ALERT_MS,
  WORKER_HEARTBEAT_STALE_ALERT_MS,
  SOURCE_FRESHNESS_DEADLINE_ALERT_SECONDS,
  REPLY_AMBIGUOUS_ALERT_MS,
} from '#/shared/observability/alert-definitions'
import { evaluateAlerts } from '#/shared/observability/alert-evaluation'

import {
  healthyAux,
  healthySnapshot,
  type MutableAux,
  type MutableSnapshot,
} from '#/shared/jobs/alert-injection.test-fixtures'

// ── Registry contract ──────────────────────────────────────────────

describe('alert registry contract (BQC-7.4)', () => {
  it('registers exactly the phase-doc alert set', () => {
    expect(ALERT_DEFINITIONS.map((d) => d.name).sort()).toEqual([
      'ai.review-analysis-empty-enrollment',
      'ai.review-analysis-stalled',
      'backup.pitr',
      'db.pool-exhaustion',
      'guest.observation-loss',
      'notification.email-bounce-rate',
      'notification.email-complaints',
      'notification.email-permanent-failures',
      'notification.email-provider-feedback-missing',
      'notification.email-retry-exhausted',
      'notification.email-stalled',
      'notification.immediate-email-acceptance-lag',
      'notification.in-app-delivery-lag',
      'observability.snapshot-degraded',
      'queue.oldest-age',
      'queue.quarantine-growth',
      'queue.quarantine-nonempty',
      'queue.stalled',
      'reply.ambiguous-aging',
      'retention.failure',
      'security.scan',
      'source.freshness-deadline',
      'sync.count-drop-persistent',
      'sync.failed-nonzero',
      'sync.head-coverage',
      'sync.push-missed',
      'sync.push-silent',
      'sync.reconciliation-age',
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
    name: 'ai.review-analysis-stalled',
    severity: 'P2',
    runbook: 'runbooks.md §22',
    threshold: REVIEW_ANALYSIS_STALLED_ALERT_MS,
    windowMs: REVIEW_ANALYSIS_STALLED_ALERT_MS,
    value: REVIEW_ANALYSIS_STALLED_ALERT_MS + 1,
    apply: (_s, aux) => {
      aux.reviewAnalysis = {
        ...aux.reviewAnalysis,
        incompletePropertyCount: 1,
        pendingSettlementCount: 4,
        oldestNoProgressAgeMs: REVIEW_ANALYSIS_STALLED_ALERT_MS + 1,
      }
    },
  },
  {
    name: 'ai.review-analysis-empty-enrollment',
    severity: 'P2',
    runbook: 'runbooks.md §22',
    threshold: 0,
    windowMs: 5 * 60 * 1000,
    value: 1,
    apply: (_s, aux) => {
      aux.reviewAnalysis = {
        ...aux.reviewAnalysis,
        zeroSnapshotEnrollmentCount: 1,
        eligibleReviewCountMissed: 18,
      }
    },
  },
  {
    name: 'observability.snapshot-degraded',
    severity: 'P1',
    runbook: 'runbooks.md §23',
    threshold: 0,
    windowMs: 10 * 60 * 1000, // two consecutive 5-minute evaluations
    value: 2, // health.outbox blinds queue.oldest-age and queue.stalled
    apply: (s) => {
      s.degraded = ['health.outbox']
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
    name: 'sync.push-missed',
    severity: 'P2',
    runbook: 'runbooks.md §4',
    threshold: 0,
    windowMs: 24 * 60 * 60 * 1000,
    value: 2,
    apply: (s) => {
      s.sync = { ...s.sync, gbpPushEnabled: true }
      s.syncPush = { ...s.syncPush, push: { ...s.syncPush.push, missed24h: 2 } }
    },
  },
  {
    name: 'sync.push-silent',
    severity: 'P2',
    runbook: 'runbooks.md §4',
    threshold: 0,
    windowMs: 24 * 60 * 60 * 1000,
    value: 3,
    apply: (s) => {
      s.sync = { ...s.sync, gbpPushEnabled: true }
      s.syncPush = { ...s.syncPush, push: { ...s.syncPush.push, newByPoll24h: 3 } }
    },
  },
  {
    name: 'sync.reconciliation-age',
    severity: 'P2',
    runbook: 'runbooks.md §13',
    threshold: 8 * 60 * 60 * 1000,
    windowMs: 8 * 60 * 60 * 1000,
    value: 9 * 60 * 60 * 1000,
    apply: (s) => {
      s.syncPush = {
        ...s.syncPush,
        reconciliation: {
          ...s.syncPush.reconciliation,
          overdueCount: 1,
          oldestAgeMs: 9 * 60 * 60 * 1000,
        },
      }
    },
  },
  {
    name: 'sync.head-coverage',
    severity: 'P2',
    runbook: 'runbooks.md §13',
    threshold: 24 * 60 * 60 * 1000,
    windowMs: 24 * 60 * 60 * 1000,
    value: 30 * 60 * 60 * 1000,
    apply: (s) => {
      s.syncPush = {
        ...s.syncPush,
        headCoverage: {
          active: true,
          uncoveredCount: 2,
          oldestUncoveredAgeMs: 30 * 60 * 60 * 1000,
        },
      }
    },
  },
  {
    name: 'sync.count-drop-persistent',
    severity: 'P2',
    runbook: 'runbooks.md §13',
    threshold: 72 * 60 * 60 * 1000,
    windowMs: 72 * 60 * 60 * 1000,
    value: 80 * 60 * 60 * 1000,
    apply: (s) => {
      s.syncPush = {
        ...s.syncPush,
        countDrop: { persistentCount: 1, oldestAgeMs: 80 * 60 * 60 * 1000 },
      }
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
    name: 'notification.email-permanent-failures',
    severity: 'P2',
    runbook: 'runbooks.md §15',
    threshold: NOTIFICATION_EMAIL_PERMANENT_FAILURE_SHARE_ALERT_PERCENT,
    windowMs: NOTIFICATION_EMAIL_OUTCOME_WINDOW_MS,
    value: 100,
    apply: (s) => {
      s.notifications.emailOutcomes.permanentFailureCount = 4
    },
  },
  {
    name: 'notification.email-bounce-rate',
    severity: 'P2',
    runbook: 'runbooks.md §15',
    threshold: NOTIFICATION_EMAIL_BOUNCE_RATE_ALERT_PERCENT,
    windowMs: NOTIFICATION_EMAIL_OUTCOME_WINDOW_MS,
    value: 10,
    apply: (s) => {
      s.notifications.emailOutcomes.acceptedCount = 30
      s.notifications.emailOutcomes.bouncedCount = 3
    },
  },
  {
    name: 'notification.email-complaints',
    severity: 'P2',
    runbook: 'runbooks.md §15',
    threshold: 0,
    windowMs: NOTIFICATION_EMAIL_OUTCOME_WINDOW_MS,
    value: 1,
    apply: (s) => {
      s.notifications.emailOutcomes.complainedCount = 1
    },
  },
  {
    name: 'notification.email-retry-exhausted',
    severity: 'P2',
    runbook: 'runbooks.md §15',
    threshold: 0,
    windowMs: NOTIFICATION_EMAIL_OUTCOME_WINDOW_MS,
    value: 2,
    apply: (s) => {
      s.notifications.emailOutcomes.retryExhaustedCount = 2
    },
  },
  {
    name: 'notification.email-provider-feedback-missing',
    severity: 'P2',
    runbook: 'runbooks.md §15',
    threshold: NOTIFICATION_EMAIL_UNRESOLVED_ALERT_COUNT,
    windowMs: NOTIFICATION_EMAIL_UNRESOLVED_LOOKBACK_MS,
    value: 5,
    apply: (s) => {
      s.notifications.emailOutcomes.acceptedUnresolvedCount = 5
      s.notifications.emailOutcomes.oldestAcceptedUnresolvedAgeMs = 26 * 60 * 60 * 1000
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
    name: 'retention.failure',
    severity: 'P1',
    runbook: 'runbooks.md §8',
    threshold: 0,
    windowMs: 24 * 60 * 60 * 1000,
    value: 1,
    apply: (_s, aux) => {
      aux.retention = { monitorAvailable: true, failedSubjects: ['reviews.purge'] }
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

      // Previously pending: a sustained alert's breach is its second in a row.
      const { toDispatch, firing } = evaluateAlerts(
        snapshot,
        aux,
        new Set(),
        new Set([breach.name]),
      )
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
        new Set([breach.name]),
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
