// Alert-definition unit tests for the freshness/delivery signals: the pure
// `evaluate` of each alert added for the notification pipeline, plus the one
// contract the registry could previously violate silently — a runbook anchor
// that does not resolve to a real section.
//
// An alert whose runbook anchor is dead is worse than no alert: it pages an
// operator and then sends them nowhere. The whole registry is checked here,
// not just the new entries.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  ALERT_DEFINITIONS,
  NOTIFICATION_EMAIL_STALLED_ALERT_MS,
  QUARANTINE_NONEMPTY_ALERT_MS,
  QUARANTINE_REDRIVE_SLA_ALERT_MS,
  SYNC_SWEEP_LAG_ALERT_MS,
  type AlertAuxReads,
} from './alert-definitions'
import type { OperationsSnapshot } from '#/shared/health/operations-snapshot'

const RUNBOOKS_PATH = 'docs/operations/runbooks.md'

/** Deep-mutable view for fixture mutation (production types are Readonly). */
type DeepMutable<T> = {
  -readonly [K in keyof T]: T[K] extends object ? DeepMutable<T[K]> : T[K]
}
type MutableSnapshot = DeepMutable<OperationsSnapshot>

/** A healthy snapshot — every alert quiet. */
function healthy(): MutableSnapshot {
  return {
    timestamp: '2026-08-21T00:00:00.000Z',
    outbox: {
      unpublishedCount: 0,
      oldestUnpublishedAgeMs: null,
      expiredLeaseCount: 0,
      claimedCount: 0,
      oldestClaimedAgeMs: null,
      stalledLeaseCount: 0,
    },
    quarantine: { count: 0, oldestAgeMs: null },
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
      heartbeat: { at: '2026-08-21T00:00:00.000Z', ageMs: 60_000, stale: false },
    },
    db: {
      pool: { max: 10, totalCount: 3, idleCount: 3, waitingCount: 0 },
      migrationVersion: 71,
    },
    cache: { tenant: { hits: 1, misses: 0, evictions: 0, size: 1 } },
    release: { sha: 'abc1234' },
    versions: {
      capabilityPolicy: 'test',
      executionPolicy: 'test-exec',
      policyStore: 1,
      routingPolicy: 1,
      sourceContentPolicy: 1,
      runtime: 'v22.0.0',
    },
    degraded: [],
  }
}

const AUX: AlertAuxReads = {
  retentionFailedSubjects: [],
  policyDenialsByReason: {},
  routingBlockedByReason: {},
}

function evaluateOne(name: string, snapshot: MutableSnapshot) {
  const def = ALERT_DEFINITIONS.find((d) => d.name === name)
  expect(def, `${name} must be registered`).toBeDefined()
  expect(def!.evaluate, `${name} must be implemented`).not.toBeNull()
  return def!.evaluate!(snapshot, AUX)
}

// ── runbook anchors ────────────────────────────────────────────────

describe('runbook anchors resolve', () => {
  it('every alert points at a section that exists in runbooks.md', () => {
    const doc = readFileSync(RUNBOOKS_PATH, 'utf-8')
    const sections = new Set(
      [...doc.matchAll(/^## (\d+)\. /gm)].map((m) => `runbooks.md §${m[1]}`),
    )
    expect(sections.size, 'runbooks.md must declare numbered sections').toBeGreaterThan(0)
    const dangling = ALERT_DEFINITIONS.filter((d) => !sections.has(d.runbook)).map(
      (d) => `${d.name} → ${d.runbook}`,
    )
    expect(
      dangling,
      'these alerts link to a runbook section that does not exist:\n' +
        dangling.join('\n'),
    ).toEqual([])
  })
})

// ── quarantine depth: dropped work ────────────────────────────────

describe('queue.quarantine-nonempty', () => {
  it('fires once a quarantined job has sat past the sustainment window', () => {
    const s = healthy()
    s.quarantine = { count: 2, oldestAgeMs: QUARANTINE_NONEMPTY_ALERT_MS + 1 }

    const event = evaluateOne('queue.quarantine-nonempty', s)

    expect(event).toMatchObject({
      name: 'queue.quarantine-nonempty',
      severity: 'P1',
      value: QUARANTINE_NONEMPTY_ALERT_MS + 1,
      threshold: QUARANTINE_NONEMPTY_ALERT_MS,
    })
    expect(event!.detail).toContain('quarantine')
  })

  it('stays silent at the boundary — a job an operator is redriving now must not page', () => {
    const s = healthy()
    s.quarantine = { count: 1, oldestAgeMs: QUARANTINE_NONEMPTY_ALERT_MS }

    expect(evaluateOne('queue.quarantine-nonempty', s)).toBeNull()
  })

  it('stays silent on an empty quarantine and when the queue handle is absent', () => {
    expect(evaluateOne('queue.quarantine-nonempty', healthy())).toBeNull()

    const noHandle = healthy()
    noHandle.quarantine = null
    expect(evaluateOne('queue.quarantine-nonempty', noHandle)).toBeNull()
  })

  it('is separable from the 24h redrive-SLA alert', () => {
    const s = healthy()
    s.quarantine = { count: 1, oldestAgeMs: QUARANTINE_NONEMPTY_ALERT_MS + 1 }

    // Fresh loss pages on §14 only; §4 is the same condition left for a day.
    expect(evaluateOne('queue.quarantine-nonempty', s)).not.toBeNull()
    expect(evaluateOne('queue.quarantine-growth', s)).toBeNull()

    s.quarantine = { count: 1, oldestAgeMs: QUARANTINE_REDRIVE_SLA_ALERT_MS + 1 }
    expect(evaluateOne('queue.quarantine-growth', s)).not.toBeNull()
  })
})

// ── sync freshness: new reviews not arriving ──────────────────────

describe('sync.sweep-lag', () => {
  it('fires when the oldest due property is overdue past four sweeps', () => {
    const s = healthy()
    s.sync = { ...s.sync, dueForIncrementalCount: 5, oldestDueAgeMs: 61 * 60 * 1000 }

    const event = evaluateOne('sync.sweep-lag', s)

    expect(event).toMatchObject({
      name: 'sync.sweep-lag',
      severity: 'P1',
      value: 61 * 60 * 1000,
      threshold: SYNC_SWEEP_LAG_ALERT_MS,
    })
    expect(event!.detail).toContain('push DARK')
  })

  it('reports live push as context without suppressing the alert', () => {
    const s = healthy()
    s.sync = {
      dueForIncrementalCount: 5,
      failedSyncCount: 0,
      oldestDueAgeMs: SYNC_SWEEP_LAG_ALERT_MS + 1,
      gbpPushEnabled: true,
    }

    const event = evaluateOne('sync.sweep-lag', s)

    expect(event).not.toBeNull()
    expect(event!.detail).toContain('push live')
  })

  it('stays silent at the boundary', () => {
    const s = healthy()
    s.sync = {
      ...s.sync,
      dueForIncrementalCount: 5,
      oldestDueAgeMs: SYNC_SWEEP_LAG_ALERT_MS,
    }

    expect(evaluateOne('sync.sweep-lag', s)).toBeNull()
  })

  it('stays silent when a big due count is fresh — a sweep mid-run is not a fault', () => {
    const s = healthy()
    s.sync = { ...s.sync, dueForIncrementalCount: 500, oldestDueAgeMs: 30_000 }

    expect(evaluateOne('sync.sweep-lag', s)).toBeNull()
  })

  it('stays silent when nothing is due', () => {
    expect(evaluateOne('sync.sweep-lag', healthy())).toBeNull()
  })
})

// ── notification delivery ─────────────────────────────────────────

describe('notification.missing-for-inbox-item', () => {
  it('fires on a single gap — nothing re-derives a missed notification', () => {
    const s = healthy()
    s.notifications = { ...s.notifications, missingForInboxItemCount: 1 }

    expect(evaluateOne('notification.missing-for-inbox-item', s)).toMatchObject({
      severity: 'P1',
      value: 1,
      threshold: 0,
    })
  })

  it('stays silent when every inbox item has its notification', () => {
    expect(evaluateOne('notification.missing-for-inbox-item', healthy())).toBeNull()
  })
})

describe('notification.email-stalled', () => {
  /** An overdue email backlog older than the stall threshold. */
  function overdue(s: MutableSnapshot, extra: Partial<MutableSnapshot['notifications']>) {
    s.notifications = {
      ...s.notifications,
      pendingOverdueCount: 4,
      oldestPendingOverdueAgeMs: NOTIFICATION_EMAIL_STALLED_ALERT_MS + 1,
      ...extra,
    }
    return s
  }

  it('fires when email delivery is enabled and the backlog is past the threshold', () => {
    const event = evaluateOne(
      'notification.email-stalled',
      overdue(healthy(), { emailDeliveryEnabled: true }),
    )

    expect(event).toMatchObject({
      name: 'notification.email-stalled',
      severity: 'P2',
      value: NOTIFICATION_EMAIL_STALLED_ALERT_MS + 1,
      threshold: NOTIFICATION_EMAIL_STALLED_ALERT_MS,
    })
    expect(event!.detail).toContain('email delivery is enabled')
  })

  // The cry-wolf guard. Outbound email is capability-dark today, so the queue
  // legitimately fills with pending rows nothing will ever send. If this
  // alert fired on that, it would be firing permanently from day one and
  // would be muted before it ever caught a real fault.
  it('stays silent when outbound email is intentionally capability-dark', () => {
    const s = overdue(healthy(), {
      emailDeliveryEnabled: false,
      attemptedStuckCount: 0,
    })

    expect(evaluateOne('notification.email-stalled', s)).toBeNull()
  })

  // …but a row the delivery path actually TOUCHED is broken regardless of the
  // global flag: that is how a per-org-allowlisted tenant's breakage pages,
  // since an org-scoped grant is not visible in the global readiness fact.
  it('fires while globally dark when the delivery path already attempted rows', () => {
    const s = overdue(healthy(), {
      emailDeliveryEnabled: false,
      attemptedStuckCount: 3,
    })

    const event = evaluateOne('notification.email-stalled', s)

    expect(event).not.toBeNull()
    expect(event!.detail).toContain('already attempted')
  })

  it('stays silent at the age boundary even with delivery enabled', () => {
    const s = healthy()
    s.notifications = {
      ...s.notifications,
      emailDeliveryEnabled: true,
      pendingOverdueCount: 4,
      oldestPendingOverdueAgeMs: NOTIFICATION_EMAIL_STALLED_ALERT_MS,
    }

    expect(evaluateOne('notification.email-stalled', s)).toBeNull()
  })

  it('stays silent when the queue has no overdue rows at all', () => {
    const s = healthy()
    s.notifications = { ...s.notifications, emailDeliveryEnabled: true }

    expect(evaluateOne('notification.email-stalled', s)).toBeNull()
  })
})
