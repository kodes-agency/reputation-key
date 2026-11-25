import type { AlertAuxReads } from '#/shared/observability/alert-definitions'
import type { OperationsSnapshot } from '#/shared/health/operations-snapshot'
import { ZERO_SYNC_PUSH_HEALTH } from '#/shared/db/sync-push-health'

/** Deep-mutable view for fixture mutation (the production types are Readonly). */
export type DeepMutable<T> = {
  -readonly [K in keyof T]: T[K] extends object ? DeepMutable<T[K]> : T[K]
}

export type MutableSnapshot = DeepMutable<OperationsSnapshot>
export type MutableAux = DeepMutable<AlertAuxReads>

/** A fully healthy operations snapshot — every implemented alert quiet. */
export function healthySnapshot(): MutableSnapshot {
  return {
    timestamp: '2026-07-31T00:00:00.000Z',
    outbox: {
      unpublishedCount: 0,
      oldestUnpublishedAgeMs: null,
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
      failedSyncCodes: {},
      oldestDueAgeMs: null,
      gbpPushEnabled: false,
    },
    syncPush: ZERO_SYNC_PUSH_HEALTH,
    notifications: {
      emailDeliveryEnabled: false,
      pendingOverdueCount: 0,
      oldestPendingOverdueAgeMs: null,
      attemptedStuckCount: 0,
      oldestAttemptedStuckAgeMs: null,
      emailOutcomes: {
        acceptedCount: 0,
        permanentFailureCount: 0,
        retryExhaustedCount: 0,
        bouncedCount: 0,
        complainedCount: 0,
        providerOutcomeCount: 0,
        acceptedUnresolvedCount: 0,
        oldestAcceptedUnresolvedAgeMs: null,
        capturedUnresolvedCount: 0,
      },
      deliveryLag: {
        sourceReceiptPending: 0,
        sourceReceiptPendingByEventType: {},
        materializationPending: 0,
        oldestSourceRecordedAt: null,
        oldestSourceAgeMs: null,
        oldestMaterializationSourceAgeMs: 0,
        oldestMaterializationEnqueuedAgeMs: 0,
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
      quarantined: 0,
      failing: 0,
      missingObservations: 0,
      invalidObservations: 0,
      handlerMissing: 0,
      schedulerMissing: 0,
      scheduleDenied: 0,
      quarantinedSchedulers: 0,
      missedObjectives: 0,
      queueAgeMissed: 0,
      stalled: 0,
      repairRequired: 0,
      deadLetters: 0,
      gateDenials: 0,
      terminalFailures: 0,
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

export function healthyAux(): MutableAux {
  return {
    retention: { monitorAvailable: true, failedSubjects: [] },
    betaFeedbackTriage: {
      monitorAvailable: true,
      deliveredUnresolvedCount: 0,
      oldestDeliveredUnresolvedAgeMs: null,
    },
    reviewAnalysis: {
      monitorAvailable: true,
      incompletePropertyCount: 0,
      pendingSettlementCount: 0,
      oldestNoProgressAgeMs: null,
      zeroSnapshotEnrollmentCount: 0,
      eligibleReviewCountMissed: 0,
    },
  }
}

export function failedSyncSnapshot(): MutableSnapshot {
  const s = healthySnapshot()
  s.sync = { ...s.sync, failedSyncCount: 1 }
  return s
}
