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
  BETA_FEEDBACK_TRIAGE_BACKLOG_ALERT_MS,
  NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS,
  NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS,
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

const AUX: AlertAuxReads = {
  retentionFailedSubjects: [],
  policyDenialsByReason: {},
  routingBlockedByReason: {},
  betaFeedbackTriage: {
    monitorAvailable: true,
    deliveredUnresolvedCount: 0,
    oldestDeliveredUnresolvedAgeMs: null,
  },
}

function evaluateOne(name: string, snapshot: MutableSnapshot, aux: AlertAuxReads = AUX) {
  const def = ALERT_DEFINITIONS.find((d) => d.name === name)
  expect(def, `${name} must be registered`).toBeDefined()
  expect(def!.evaluate, `${name} must be implemented`).not.toBeNull()
  return def!.evaluate!(snapshot, aux)
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

// ── governed job runtime ──────────────────────────────────────────

describe('worker.job-runtime-unready', () => {
  it('fires when any governed family misses registration, freshness, or repair', () => {
    const s = healthy()
    s.jobs = {
      ready: false,
      total: 1,
      active: 1,
      dark: 0,
      quarantined: 0,
      failing: 1,
      missingObservations: 0,
      handlerMissing: 0,
      schedulerMissing: 1,
      forbiddenDarkWork: 0,
      quarantinedSchedulers: 0,
      missedObjectives: 1,
      queueAgeMissed: 0,
      stalled: 0,
      repairRequired: 0,
      deadLetters: 0,
      rows: [],
    }

    const event = evaluateOne('worker.job-runtime-unready', s)

    expect(event).toMatchObject({
      name: 'worker.job-runtime-unready',
      severity: 'P1',
      value: 1,
      threshold: 0,
    })
    expect(event!.detail).toContain('schedulerMissing=1')
    expect(event!.detail).toContain('missedObjectives=1')
  })

  it('stays silent when ready and fails visible when the authority is unavailable', () => {
    const ready = healthy()
    ready.jobs = {
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
    }
    expect(evaluateOne('worker.job-runtime-unready', ready)).toBeNull()

    const unavailable = healthy()
    delete unavailable.jobs
    unavailable.degraded = ['jobs']
    const unavailableEvent = evaluateOne('worker.job-runtime-unready', unavailable)
    expect(unavailableEvent).toMatchObject({ value: 1, threshold: 0 })
    expect(unavailableEvent!.detail).toContain('unavailable')
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

describe('sync.failed-nonzero', () => {
  it('fires when any coded sync failure has reached its retry time', () => {
    const s = healthy()
    s.sync = { ...s.sync, failedSyncCount: 2 }

    expect(evaluateOne('sync.failed-nonzero', s)).toMatchObject({
      name: 'sync.failed-nonzero',
      severity: 'P2',
      value: 2,
      threshold: 0,
    })
  })

  it('stays silent when no sync failure is due', () => {
    expect(evaluateOne('sync.failed-nonzero', healthy())).toBeNull()
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

describe('notification.in-app-delivery-lag', () => {
  it('fires from durable source age when either delivery stage exceeds 60 seconds', () => {
    const source = healthy()
    source.notifications.deliveryLag = {
      ...source.notifications.deliveryLag,
      sourceReceiptPending: 2,
      oldestSourceRecordedAt: '2026-08-20T23:58:59.999Z',
      oldestSourceAgeMs: NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS + 1,
      sourceSaturated: true,
    }
    const sourceEvent = evaluateOne('notification.in-app-delivery-lag', source)
    expect(sourceEvent).toMatchObject({
      severity: 'P1',
      value: NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS + 1,
      threshold: NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS,
    })
    expect(sourceEvent!.detail).toContain('source receipts=2+')

    const materialization = healthy()
    materialization.notifications.deliveryLag = {
      ...materialization.notifications.deliveryLag,
      materializationPending: 1,
      oldestMaterializationSourceRecordedAt: '2026-08-20T23:58:59.999Z',
      oldestMaterializationSourceAgeMs: NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS + 1,
      oldestMaterializationEnqueuedAt: '2026-08-20T23:59:30.000Z',
      oldestMaterializationEnqueuedAgeMs: 30_000,
    }
    expect(
      evaluateOne('notification.in-app-delivery-lag', materialization),
    ).toMatchObject({
      value: NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS + 1,
    })
  })

  it('stays silent at 60 seconds and when no delivery is pending', () => {
    const boundary = healthy()
    boundary.notifications.deliveryLag = {
      ...boundary.notifications.deliveryLag,
      sourceReceiptPending: 1,
      oldestSourceRecordedAt: '2026-08-20T23:59:00.000Z',
      oldestSourceAgeMs: NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS,
    }
    expect(evaluateOne('notification.in-app-delivery-lag', boundary)).toBeNull()
    expect(evaluateOne('notification.in-app-delivery-lag', healthy())).toBeNull()
  })
})

describe('notification.immediate-email-acceptance-lag', () => {
  it('fires when source-clock p99 or the oldest awaiting attempt exceeds five minutes', () => {
    const accepted = healthy()
    accepted.notifications.deliveryLag.immediateEmailAcceptance = {
      ...accepted.notifications.deliveryLag.immediateEmailAcceptance,
      acceptedLatencyP99Ms: NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS + 1,
      acceptedSampleCount: 100,
    }
    expect(
      evaluateOne('notification.immediate-email-acceptance-lag', accepted),
    ).toMatchObject({
      severity: 'P2',
      value: NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS + 1,
      threshold: NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS,
    })

    const awaiting = healthy()
    awaiting.notifications.emailDeliveryEnabled = true
    awaiting.notifications.deliveryLag.immediateEmailAcceptance = {
      ...awaiting.notifications.deliveryLag.immediateEmailAcceptance,
      awaitingProviderAcceptance: 2,
      oldestAwaitingSourceRecordedAt: '2026-08-20T23:54:59.999Z',
      oldestAwaitingSourceAgeMs: NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS + 1,
    }
    expect(
      evaluateOne('notification.immediate-email-acceptance-lag', awaiting),
    ).toMatchObject({
      value: NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS + 1,
    })
  })

  it('uses attempted work as per-Organization activation evidence and stays quiet at the boundary', () => {
    const perOrganization = healthy()
    perOrganization.notifications.deliveryLag.immediateEmailAcceptance = {
      ...perOrganization.notifications.deliveryLag.immediateEmailAcceptance,
      awaitingProviderAcceptance: 1,
      attemptedAwaitingProviderAcceptance: 1,
      oldestAwaitingSourceRecordedAt: '2026-08-20T23:54:59.999Z',
      oldestAwaitingSourceAgeMs: NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS + 1,
    }
    expect(
      evaluateOne('notification.immediate-email-acceptance-lag', perOrganization),
    ).not.toBeNull()

    const boundary = healthy()
    boundary.notifications.emailDeliveryEnabled = true
    boundary.notifications.deliveryLag.immediateEmailAcceptance = {
      ...boundary.notifications.deliveryLag.immediateEmailAcceptance,
      awaitingProviderAcceptance: 1,
      oldestAwaitingSourceRecordedAt: '2026-08-20T23:55:00.000Z',
      oldestAwaitingSourceAgeMs: NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS,
    }
    expect(
      evaluateOne('notification.immediate-email-acceptance-lag', boundary),
    ).toBeNull()

    const intentionallyDark = healthy()
    intentionallyDark.notifications.deliveryLag.immediateEmailAcceptance = {
      ...intentionallyDark.notifications.deliveryLag.immediateEmailAcceptance,
      awaitingProviderAcceptance: 5,
      oldestAwaitingSourceRecordedAt: '2026-08-20T20:00:00.000Z',
      oldestAwaitingSourceAgeMs: 4 * 60 * 60 * 1000,
    }
    expect(
      evaluateOne('notification.immediate-email-acceptance-lag', intentionallyDark),
    ).toBeNull()
  })

  it('fails honestly when active evidence is unlinked or the bounded sample saturates', () => {
    const unlinked = healthy()
    unlinked.notifications.emailDeliveryEnabled = true
    unlinked.notifications.deliveryLag.immediateEmailAcceptance = {
      ...unlinked.notifications.deliveryLag.immediateEmailAcceptance,
      sourceUnlinked: 1,
    }
    const unlinkedEvent = evaluateOne(
      'notification.immediate-email-acceptance-lag',
      unlinked,
    )
    expect(unlinkedEvent?.detail).toContain('durable source')

    const saturated = healthy()
    saturated.notifications.deliveryLag.immediateEmailAcceptance = {
      ...saturated.notifications.deliveryLag.immediateEmailAcceptance,
      acceptedSampleCount: 1_000,
      saturated: true,
    }
    const saturatedEvent = evaluateOne(
      'notification.immediate-email-acceptance-lag',
      saturated,
    )
    expect(saturatedEvent?.detail).toContain('saturated')
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

describe('guest.observation-loss', () => {
  it('fires on a true suppressed scan or review-link loss', () => {
    const s = healthy()
    s.guestObservationLoss = {
      ...s.guestObservationLoss!,
      scanLossCount: 2,
      reviewLinkLossCount: 1,
      totalLossCount: 3,
    }

    const event = evaluateOne('guest.observation-loss', s)
    expect(event).toMatchObject({
      name: 'guest.observation-loss',
      severity: 'P1',
      value: 3,
      threshold: 0,
      windowMs: 24 * 60 * 60 * 1000,
    })
    expect(event!.detail).toContain('scans=2')
    expect(event!.detail).toContain('reviewLinks=1')
    expect(event!.detail).toContain('ratings=not_applicable_durable')
  })

  it('fails visible when the monitor is unavailable and stays quiet for durable ratings', () => {
    const unavailable = healthy()
    unavailable.guestObservationLoss = {
      ...unavailable.guestObservationLoss!,
      monitorAvailable: false,
    }
    const event = evaluateOne('guest.observation-loss', unavailable)
    expect(event).toMatchObject({ value: 1, threshold: 0 })
    expect(event!.detail).toContain('unavailable')

    expect(evaluateOne('guest.observation-loss', healthy())).toBeNull()
    expect(healthy().guestObservationLoss).toMatchObject({
      ratingLossCount: 0,
      ratingDisposition: 'not_applicable_durable',
    })
  })
})

describe('beta-feedback.triage-backlog', () => {
  it('fires on a delivered unresolved report older than the bounded backlog window', () => {
    const event = evaluateOne('beta-feedback.triage-backlog', healthy(), {
      ...AUX,
      betaFeedbackTriage: {
        monitorAvailable: true,
        deliveredUnresolvedCount: 3,
        oldestDeliveredUnresolvedAgeMs: BETA_FEEDBACK_TRIAGE_BACKLOG_ALERT_MS + 1,
      },
    })

    expect(event).toMatchObject({
      name: 'beta-feedback.triage-backlog',
      severity: 'P2',
      value: BETA_FEEDBACK_TRIAGE_BACKLOG_ALERT_MS + 1,
      threshold: BETA_FEEDBACK_TRIAGE_BACKLOG_ALERT_MS,
      runbook: 'runbooks.md §16',
    })
    expect(event!.detail).toContain('3 delivered unresolved')
  })

  it('stays quiet for an empty queue and at the exact age boundary', () => {
    expect(evaluateOne('beta-feedback.triage-backlog', healthy())).toBeNull()
    expect(
      evaluateOne('beta-feedback.triage-backlog', healthy(), {
        ...AUX,
        betaFeedbackTriage: {
          monitorAvailable: true,
          deliveredUnresolvedCount: 1,
          oldestDeliveredUnresolvedAgeMs: BETA_FEEDBACK_TRIAGE_BACKLOG_ALERT_MS,
        },
      }),
    ).toBeNull()
  })

  it('fails visible without exposing report or tenant content when its DB read fails', () => {
    const event = evaluateOne('beta-feedback.triage-backlog', healthy(), {
      ...AUX,
      betaFeedbackTriage: {
        monitorAvailable: false,
        deliveredUnresolvedCount: 0,
        oldestDeliveredUnresolvedAgeMs: null,
      },
    })

    expect(event).toMatchObject({ value: -1 })
    expect(event!.detail).toBe('beta-feedback triage backlog monitor unavailable')
  })
})
