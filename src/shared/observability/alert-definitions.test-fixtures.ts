import { ZERO_SYNC_PUSH_HEALTH } from '#/shared/db/sync-push-health'
import type { AlertAuxReads } from './alert-definitions'
import { ALERT_DEFINITIONS } from './alert-definitions'
import type { OperationsSnapshot } from '#/shared/health/operations-snapshot'
import type { JobRuntimeReportRow } from '#/shared/jobs/runtime-observations'

/** Deep-mutable view for fixture mutation (production types are Readonly). */
export type DeepMutable<T> = {
  -readonly [K in keyof T]: T[K] extends object ? DeepMutable<T[K]> : T[K]
}
export type MutableSnapshot = DeepMutable<OperationsSnapshot>

/** One governed job family's report row; `ready` follows `reasons`. */
export function jobRow(
  jobName: string,
  reasons: JobRuntimeReportRow['reasons'] = [],
  deadLetterCount = 0,
): JobRuntimeReportRow {
  return {
    jobName,
    owner: 'review',
    processor: 'sync',
    action: 'sync',
    routing: 'cell_local',
    capability: 'review.sync',
    posture: 'active',
    queue: 'background',
    schedule: 'none',
    retryAttempts: 3,
    retryBackoff: 'exponential',
    timeoutMs: 60_000,
    workerConcurrency: 1,
    retention: 'default',
    lastSuccessObjectiveMs: null,
    maximumQueueAgeMs: 60_000,
    ready: reasons.length === 0,
    reasons,
    lastSucceededAt: null,
    lastDeniedAt: null,
    lastOnDemandFailureAt: null,
    lastScheduleFailureAt: null,
    failedCount: 0,
    deniedCount: 0,
    oldestWaitingAt: null,
    deadLetterCount,
    repairCommand: 'none',
    runbook: 'runbooks.md §17',
  }
}

/** A healthy snapshot — every alert quiet. */
export function healthy(): MutableSnapshot {
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

export const AUX: AlertAuxReads = {
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

export function evaluateOne(
  name: string,
  snapshot: MutableSnapshot,
  aux: AlertAuxReads = AUX,
) {
  const def = ALERT_DEFINITIONS.find((d) => d.name === name)
  expect(def, `${name} must be registered`).toBeDefined()
  expect(def!.evaluate, `${name} must be implemented`).not.toBeNull()
  return def!.evaluate!(snapshot, aux)
}

/** A snapshot with push configured and the given push readings. */
export function withPush(
  push: Partial<MutableSnapshot['syncPush']['push']>,
  gbpPushEnabled = true,
): MutableSnapshot {
  const s = healthy()
  s.sync = { ...s.sync, gbpPushEnabled }
  s.syncPush = { ...s.syncPush, push: { ...s.syncPush.push, ...push } }
  return s
}

/** The all-ready governed-jobs report with only the given counters changed. */
export function jobsReport(
  overrides: Partial<NonNullable<MutableSnapshot['jobs']>>,
): NonNullable<MutableSnapshot['jobs']> {
  return { ...healthy().jobs!, ...overrides }
}
