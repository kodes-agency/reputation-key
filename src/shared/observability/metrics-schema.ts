// BQC-7.3 — Observability schema.
//
// The ONE registry of operational metric definitions + the executable label
// policy for logs/metrics/traces. Two halves:
//
//   1. METRIC_DEFINITIONS — every metric family the platform records, with
//      kind/unit and a CLOSED label policy (low-cardinality value sets or a
//      constrained pattern). Definitions with `emitted: false` are registered
//      names only — BQC-7.4 wires their emission/aggregation; nothing may
//      emit a metric that is not registered here.
//   2. The label/correlation policy as data — APPROVED_CORRELATION_FIELDS and
//      BANNED_LOG_KEYS — consumed by the architecture gate
//      (architecture/observability-schema.test.ts) which scans every logger
//      call-site and fails on a banned key.
//
// Cardinality rule (slice doc): route classes, queue names, stable reason
// enums, and version names are labels. Tenant identifiers (organization,
// property, user, review, reply, job, event, connection, inbox, portal,
// session, …) are NEVER labels and never log fields — the only approved
// correlation fields are requestId (per-trace) and correlationId (domain
// events, ADR 0030 identifier-only by design).

import {
  SENSITIVE_OBSERVABILITY_FIELD_NAMES,
  isSensitiveObservabilityField,
} from '#/shared/observability/sensitive-field-policy'

// ── Label policy ─────────────────────────────────────────────────

/** Closed low-cardinality set — every value must be listed. */
export type ClosedLabel = Readonly<{ values: readonly string[] }>
/** Constrained open set — values must match the pattern (route classes, SHAs). */
export type PatternLabel = Readonly<{ pattern: RegExp }>
export type LabelSpec = ClosedLabel | PatternLabel

/** The four BullMQ queues (composition + worker; static names). */
export const QUEUE_NAMES = [
  'default',
  'background',
  'domain-events',
  'quarantine',
] as const

/** Queue-depth row states (readAllQueueDepths). */
const QUEUE_DEPTH_STATES = ['waiting', 'active', 'delayed', 'failed', 'paused'] as const


/** Reply publication_state — the DB CHECK constraint set (review.schema). */
export const PUBLICATION_STATES = [
  'requested',
  'authorized',
  'sending',
  'published',
  'terminal',
  'ambiguous',
  'cancelled',
] as const

/** OperationsSnapshot degraded-section markers (operations-snapshot.ts). */
export const SNAPSHOT_SECTIONS = [
  'health',
  'queues',
  'workers.heartbeat',
  'runtime',
  'jobs',
  'guest.observationLoss',
] as const

/** Route-class label: dotted server-fn / use-case names (e.g. review.syncReviews). */
// eslint-disable-next-line security/detect-unsafe-regex -- BQC-7.7 (owner: platform): each outer-group iteration must consume a literal dot, so repetitions cannot overlap; safe-regex star-height false positive
const USE_CASE_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_-]+)*$/
/** Release identity: a git SHA (short or full) or the explicit unknown marker. */
const RELEASE_SHA_PATTERN = /^([0-9a-f]{7,40}|unknown)$/
/** Runtime version: node's process.version (vMAJOR.MINOR.PATCH). */
const RUNTIME_VERSION_PATTERN = /^v\d+\.\d+\.\d+$/

const useCase: PatternLabel = { pattern: USE_CASE_PATTERN }
const queue: ClosedLabel = { values: QUEUE_NAMES }

// ── Metric registry ──────────────────────────────────────────────

export type MetricKind = 'counter' | 'gauge'

export type MetricDefinition = Readonly<{
  /** Canonical dotted metric name (family.subject). */
  name: string
  kind: MetricKind
  unit: 'count' | 'ms' | 'seconds' | 'info'
  /** Label name → closed/patterned value policy. Empty = unlabeled. */
  labels: Readonly<Record<string, LabelSpec>>
  /**
   * Dot-separated field paths in the OperationsSnapshot when this metric is
   * emitted there (`*` marks an array element or a per-label-value object
   * key). The architecture gate walks a real snapshot and requires every
   * leaf to resolve to a registered path (or an explicit non-metric
   * allowlist entry in the test).
   */
  snapshotPath?: readonly string[]
  /** false = registered name only; BQC-7.4 wires emission/aggregation. */
  emitted: boolean
  description: string
}>

function def(d: MetricDefinition): MetricDefinition {
  return d
}

export const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  // ── guest observation loss — bounded, global, content-free ──
  def({
    name: 'guest.observation_loss.monitor_available',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['guestObservationLoss.monitorAvailable'],
    emitted: true,
    description:
      '1 when the cross-replica Guest best-effort observation-loss aggregate proves a complete trailing window.',
  }),
  def({
    name: 'guest.observation_loss.scan',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['guestObservationLoss.scanLossCount'],
    emitted: true,
    description: 'Suppressed scan observations in the bounded trailing window.',
  }),
  def({
    name: 'guest.observation_loss.review_link',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['guestObservationLoss.reviewLinkLossCount'],
    emitted: true,
    description:
      'Suppressed qualified Google or secondary-link observations in the bounded trailing window.',
  }),
  def({
    name: 'guest.observation_loss.rating',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['guestObservationLoss.ratingLossCount'],
    emitted: true,
    description:
      'Always zero: private ratings use atomic durable fact/outbox persistence and are not best-effort analytics.',
  }),
  def({
    name: 'guest.observation_loss.total',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['guestObservationLoss.totalLossCount'],
    emitted: true,
    description: 'Suppressed scan plus review-link observations in the bounded window.',
  }),

  // ── request.* — route-class rate/error/latency (7.4 wires emission) ──
  def({
    name: 'request.rate',
    kind: 'counter',
    unit: 'count',
    labels: { useCase },
    emitted: false,
    description: 'Requests by route class (server-fn name). Never tenant-labeled.',
  }),
  def({
    name: 'request.errors',
    kind: 'counter',
    unit: 'count',
    labels: { useCase },
    emitted: false,
    description: 'Failed requests by route class.',
  }),
  def({
    name: 'request.latency_ms',
    kind: 'counter',
    unit: 'ms',
    labels: { useCase },
    emitted: false,
    description: 'Total request latency by route class (avg = latency/rate).',
  }),

  // ── db.* — pool budget + migration version ──
  def({
    name: 'db.pool.max',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['db.pool.max'],
    emitted: true,
    description: 'Configured pool size (pg Pool max).',
  }),
  def({
    name: 'db.pool.total',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['db.pool.totalCount'],
    emitted: true,
    description: 'Total clients currently in the pool.',
  }),
  def({
    name: 'db.pool.idle',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['db.pool.idleCount'],
    emitted: true,
    description: 'Idle clients in the pool.',
  }),
  def({
    name: 'db.pool.waiting',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['db.pool.waitingCount'],
    emitted: true,
    description: 'Queued acquisition requests (pool saturation signal).',
  }),
  def({
    name: 'db.migration.version',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['db.migrationVersion'],
    emitted: true,
    description: 'Applied migration count (drizzle journal rows).',
  }),

  // ── queue.* / outbox.* — depth, age, lag, lease health ──
  def({
    name: 'queue.depth',
    kind: 'gauge',
    unit: 'count',
    labels: { queue, state: { values: QUEUE_DEPTH_STATES } },
    snapshotPath: QUEUE_DEPTH_STATES.map((s) => `queues.*.${s}`),
    emitted: true,
    description: 'BullMQ job counts by queue and state.',
  }),
  def({
    name: 'queue.quarantine.depth',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['quarantine.count'],
    emitted: true,
    description: 'Dead-letter quarantine depth (operator-drained).',
  }),
  def({
    name: 'queue.quarantine.oldest_age_ms',
    kind: 'gauge',
    unit: 'ms',
    labels: {},
    snapshotPath: ['quarantine.oldestAgeMs'],
    emitted: true,
    description: 'Age of the oldest quarantined job.',
  }),
  def({
    name: 'queue.redrive',
    kind: 'counter',
    unit: 'count',
    labels: { queue },
    emitted: false,
    description: 'Quarantine redrive requests (7.4 wires emission).',
  }),
  def({
    name: 'outbox.lag',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['outbox.unpublishedCount'],
    emitted: true,
    description: 'Unpublished outbox events (relay lag).',
  }),
  def({
    name: 'outbox.oldest_unpublished_age_ms',
    kind: 'gauge',
    unit: 'ms',
    labels: {},
    snapshotPath: ['outbox.oldestUnpublishedAgeMs'],
    emitted: true,
    description: 'Age of the oldest unpublished outbox event.',
  }),
  def({
    name: 'outbox.claimed',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['outbox.claimedCount'],
    emitted: true,
    description: 'In-flight relay claims (unexpired leases).',
  }),
  def({
    name: 'outbox.oldest_claimed_age_ms',
    kind: 'gauge',
    unit: 'ms',
    labels: {},
    snapshotPath: ['outbox.oldestClaimedAgeMs'],
    emitted: true,
    description: 'Age of the oldest in-flight claim.',
  }),
  def({
    name: 'outbox.stalled_leases',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['outbox.stalledLeaseCount'],
    emitted: true,
    description: 'Leases held beyond 2× duration (stalled relay).',
  }),
  def({
    name: 'outbox.expired_leases',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['outbox.expiredLeaseCount'],
    emitted: true,
    description: 'Unpublished rows whose lease expired (bounded scan).',
  }),

  // ── worker.* — heartbeat + registered jobs/runtime ──
  def({
    name: 'worker.heartbeat.age_ms',
    kind: 'gauge',
    unit: 'ms',
    labels: {},
    snapshotPath: ['workers.heartbeat.ageMs'],
    emitted: true,
    description: 'Age of the last worker heartbeat write.',
  }),
  def({
    name: 'worker.heartbeat.stale',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['workers.heartbeat.stale'],
    emitted: true,
    description: '1 when the heartbeat is missing or older than 2× interval.',
  }),
  def({
    name: 'worker.registered_jobs',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    emitted: true,
    description: 'Job handlers registered at worker boot (boot log field).',
  }),
  def({
    name: 'worker.job_runtime.ready',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['jobs.ready'],
    emitted: true,
    description: '1 when every governed job family satisfies its runtime contract.',
  }),
  def({
    name: 'worker.job_runtime.families',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: [
      'jobs.total',
      'jobs.active',
      'jobs.dark',
      'jobs.quarantined',
      'jobs.failing',
    ],
    emitted: true,
    description: 'Governed job families by operational posture and readiness.',
  }),
  def({
    name: 'worker.job_runtime.failures',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: [
      'jobs.missingObservations',
      'jobs.handlerMissing',
      'jobs.schedulerMissing',
      'jobs.forbiddenDarkWork',
      'jobs.quarantinedSchedulers',
      'jobs.missedObjectives',
      'jobs.queueAgeMissed',
      'jobs.stalled',
      'jobs.repairRequired',
      'jobs.deadLetters',
    ],
    emitted: true,
    description:
      'Job runtime contract failures, including missed work and repair ownership.',
  }),
  def({
    name: 'worker.runtime.version',
    kind: 'gauge',
    unit: 'info',
    labels: { version: { pattern: RUNTIME_VERSION_PATTERN } },
    snapshotPath: ['versions.runtime'],
    emitted: true,
    description: 'Node runtime version (process.version).',
  }),

  // ── sync.* — Google sync freshness, webhook dedupe, provider health ──
  def({
    name: 'sync.due_for_incremental',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['sync.dueForIncrementalCount'],
    emitted: true,
    description: 'Properties past their next incremental sync time.',
  }),
  def({
    name: 'sync.oldest_due_age_ms',
    kind: 'gauge',
    unit: 'ms',
    labels: {},
    snapshotPath: ['sync.oldestDueAgeMs'],
    emitted: true,
    description:
      'Age of the OLDEST past-due next_incremental_at — discovery-sweep lag. A count of due properties cannot distinguish a sweep mid-run from a dead sweep; this can. Null/absent when nothing is overdue.',
  }),
  def({
    name: 'sync.failed',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['sync.failedSyncCount'],
    emitted: true,
    description: 'Syncs in error whose retry is due.',
  }),
  def({
    name: 'sync.gbp_push_enabled',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['sync.gbpPushEnabled'],
    emitted: true,
    description:
      '1 when GBP_PUBSUB_TOPIC is configured. 0 = Google push notifications are dark and new reviews only arrive on the discover-new-reviews sweep cadence.',
  }),
  def({
    name: 'sync.webhook.dedupe',
    kind: 'counter',
    unit: 'count',
    labels: {},
    emitted: false,
    description: 'Webhook deliveries dropped by the message-id dedupe (7.4).',
  }),
  def({
    name: 'sync.provider.throttle',
    kind: 'counter',
    unit: 'count',
    labels: {},
    emitted: false,
    description: 'Provider quota/throttle responses (7.4).',
  }),
  def({
    name: 'sync.provider.reconnect',
    kind: 'counter',
    unit: 'count',
    labels: {},
    emitted: false,
    description: 'Provider connection re-establishments (7.4).',
  }),

  // ── notification.* — did the user actually get told? ──
  def({
    name: 'notification.email.delivery_enabled',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['notifications.emailDeliveryEnabled'],
    emitted: true,
    description:
      '1 when notification.send_email is globally enabled. 0 = outbound email is capability-dark, so a pending email backlog is EXPECTED and notification.email-stalled deliberately stays silent. Read this before concluding email is broken. A per-org allowlist grant is not globally enumerable and does not flip this to 1.',
  }),
  def({
    name: 'notification.email.pending_overdue',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['notifications.pendingOverdueCount'],
    emitted: true,
    description:
      'Queued notification emails still `pending` past their due time (next_attempt_at → not_before → created_at).',
  }),
  def({
    name: 'notification.email.oldest_pending_overdue_age_ms',
    kind: 'gauge',
    unit: 'ms',
    labels: {},
    snapshotPath: ['notifications.oldestPendingOverdueAgeMs'],
    emitted: true,
    description:
      'How far past its due time the oldest pending notification email is. Null/absent when nothing is overdue.',
  }),
  def({
    name: 'notification.email.attempted_stuck',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['notifications.attemptedStuckCount'],
    emitted: true,
    description:
      'Overdue pending emails the delivery path ALREADY attempted (attempted_at set). Non-zero cannot be explained by a dark capability — the sweep reached the row, tried, and left it pending.',
  }),
  def({
    name: 'notification.email.immediate_acceptance_pending',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: [
      'notifications.deliveryLag.immediateEmailAcceptance.awaitingProviderAcceptance',
    ],
    emitted: true,
    description:
      'Sendable immediate notification emails that have not received provider acceptance inside the bounded source-clock window.',
  }),
  def({
    name: 'notification.email.immediate_acceptance_attempted_pending',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: [
      'notifications.deliveryLag.immediateEmailAcceptance.attemptedAwaitingProviderAcceptance',
    ],
    emitted: true,
    description:
      'Immediate notification emails still awaiting acceptance after a provider attempt began; also proves per-Organization delivery activation.',
  }),
  def({
    name: 'notification.email.immediate_acceptance_oldest_source_age_ms',
    kind: 'gauge',
    unit: 'ms',
    labels: {},
    snapshotPath: [
      'notifications.deliveryLag.immediateEmailAcceptance.oldestAwaitingSourceAgeMs',
    ],
    emitted: true,
    description:
      'Age from the durable source fact for the oldest immediate notification email still awaiting provider acceptance.',
  }),
  def({
    name: 'notification.email.immediate_acceptance_p99_ms',
    kind: 'gauge',
    unit: 'ms',
    labels: {},
    snapshotPath: [
      'notifications.deliveryLag.immediateEmailAcceptance.acceptedLatencyP99Ms',
    ],
    emitted: true,
    description:
      'Exact source-to-provider-acceptance p99 for the bounded window; absent when the sample saturated.',
  }),
  def({
    name: 'notification.email.immediate_acceptance_sample_count',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: [
      'notifications.deliveryLag.immediateEmailAcceptance.acceptedSampleCount',
    ],
    emitted: true,
    description:
      'Accepted immediate notification email rows included in the source-clock p99 calculation.',
  }),
  def({
    name: 'notification.email.immediate_acceptance_source_unlinked',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['notifications.deliveryLag.immediateEmailAcceptance.sourceUnlinked'],
    emitted: true,
    description:
      'Active immediate notification email rows without a matching durable source fact; non-zero makes the latency target unevaluable.',
  }),
  def({
    name: 'notification.email.immediate_acceptance_saturated',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['notifications.deliveryLag.immediateEmailAcceptance.saturated'],
    emitted: true,
    description:
      '1 when immediate notification email acceptance evidence exceeded the bounded scan cap and full-window p99 is unavailable.',
  }),
  def({
    name: 'notification.missing_for_inbox_item',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['notifications.missingForInboxItemCount'],
    emitted: true,
    description:
      'Inbox items past the reconciliation grace edge with NO notification row for anybody — "a review arrived and nobody was told". Above zero means the in-process fan-out dropped it AND reconcile-missing-notifications has not healed it yet, or that sweep is not running. Saturates at its scan cap (1000); the alert fires on above-zero, so the cap is immaterial.',
  }),
  def({
    name: 'notification.delivery.source_receipt_pending',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['notifications.deliveryLag.sourceReceiptPending'],
    emitted: true,
    description:
      'Active Notification source events past the grace edge without their durable consumer receipt. Bounded; read sourceSaturated with it.',
  }),
  def({
    name: 'notification.delivery.materialization_pending',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['notifications.deliveryLag.materializationPending'],
    emitted: true,
    description:
      'Redis-accepted Notification deliveries without an atomic PostgreSQL materialization receipt. Bounded; read materializationSaturated with it.',
  }),
  def({
    name: 'notification.delivery.oldest_source_age_ms',
    kind: 'gauge',
    unit: 'ms',
    labels: {},
    snapshotPath: ['notifications.deliveryLag.oldestSourceAgeMs'],
    emitted: true,
    description:
      'Age from the oldest active durable source missing its base Notification consumer receipt.',
  }),
  def({
    name: 'notification.delivery.oldest_materialization_source_age_ms',
    kind: 'gauge',
    unit: 'ms',
    labels: {},
    snapshotPath: ['notifications.deliveryLag.oldestMaterializationSourceAgeMs'],
    emitted: true,
    description:
      'End-to-end age from durable source for the oldest Redis-accepted delivery still missing PostgreSQL materialization.',
  }),
  def({
    name: 'notification.delivery.oldest_materialization_enqueue_age_ms',
    kind: 'gauge',
    unit: 'ms',
    labels: {},
    snapshotPath: ['notifications.deliveryLag.oldestMaterializationEnqueuedAgeMs'],
    emitted: true,
    description:
      'Redis→PostgreSQL stage age for the oldest accepted delivery still missing materialization.',
  }),
  def({
    name: 'notification.delivery.source_saturated',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['notifications.deliveryLag.sourceSaturated'],
    emitted: true,
    description: '1 when the bounded missing-source-receipt scan reached its cap.',
  }),
  def({
    name: 'notification.delivery.materialization_saturated',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['notifications.deliveryLag.materializationSaturated'],
    emitted: true,
    description:
      '1 when the bounded accepted-but-unmaterialized delivery scan reached its cap.',
  }),

  // ── source.* — refresh-due / expiry / purge lifecycle ──
  def({
    name: 'source.active_total',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['reviews.totalActive'],
    emitted: true,
    description: 'Reviews under content-lifecycle management.',
  }),
  def({
    name: 'source.refresh_due',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['reviews.refreshDueCount'],
    emitted: true,
    description: 'Reviews past the refresh-due threshold (25d).',
  }),
  def({
    name: 'source.expired',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['reviews.expiredCount'],
    emitted: true,
    description: 'Reviews past hard content expiry (purge backlog).',
  }),
  def({
    name: 'source.oldest_due_age_seconds',
    kind: 'gauge',
    unit: 'seconds',
    labels: {},
    snapshotPath: ['reviews.oldestDueAgeSeconds'],
    emitted: true,
    description: 'Seconds until the nearest hard expiry among refresh-due rows.',
  }),
  def({
    name: 'source.purge.failures',
    kind: 'counter',
    unit: 'count',
    labels: {},
    emitted: false,
    description: 'Content purge failures (7.4 wires emission).',
  }),

  // ── reply.publication.* — publication state + ambiguity age ──
  def({
    name: 'reply.publication.state',
    kind: 'gauge',
    unit: 'count',
    labels: { state: { values: PUBLICATION_STATES } },
    snapshotPath: PUBLICATION_STATES.map((s) => `replyPublication.counts.${s}`),
    emitted: true,
    description: 'Replies by persisted publication_state.',
  }),
  def({
    name: 'reply.publication.oldest_ambiguous_age_ms',
    kind: 'gauge',
    unit: 'ms',
    labels: {},
    snapshotPath: ['replyPublication.oldestAmbiguousAgeMs'],
    emitted: true,
    description: 'Age of the oldest ambiguous row past reconcile_due_at.',
  }),


  // ── cache.* — tenant-resolution cache ──
  def({
    name: 'cache.tenant.hits',
    kind: 'counter',
    unit: 'count',
    labels: {},
    snapshotPath: ['cache.tenant.hits'],
    emitted: true,
    description: 'Tenant cache serves (fresh entry).',
  }),
  def({
    name: 'cache.tenant.misses',
    kind: 'counter',
    unit: 'count',
    labels: {},
    snapshotPath: ['cache.tenant.misses'],
    emitted: true,
    description: 'Tenant cache lookups that resolved fresh.',
  }),
  def({
    name: 'cache.tenant.evictions',
    kind: 'counter',
    unit: 'count',
    labels: {},
    snapshotPath: ['cache.tenant.evictions'],
    emitted: true,
    description: 'Tenant cache evictions (max-size + stale-version drops).',
  }),
  def({
    name: 'cache.tenant.size',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['cache.tenant.size'],
    emitted: true,
    description: 'Current tenant cache entries.',
  }),

  // ── release / versions — deploy + policy identity ──
  def({
    name: 'release.sha',
    kind: 'gauge',
    unit: 'info',
    labels: { sha: { pattern: RELEASE_SHA_PATTERN } },
    snapshotPath: ['release.sha'],
    emitted: true,
    description:
      'Deploy identity (RELEASE_SHA ?? RAILWAY_GIT_COMMIT_SHA ?? unknown). Logged at boot.',
  }),
  def({
    name: 'versions.capability_policy',
    kind: 'gauge',
    unit: 'info',
    labels: {},
    snapshotPath: ['versions.capabilityPolicy'],
    emitted: true,
    description: 'CAPABILITY_POLICY_VERSION (boot manifest).',
  }),
  def({
    name: 'versions.execution_policy',
    kind: 'gauge',
    unit: 'info',
    labels: {},
    snapshotPath: ['versions.executionPolicy'],
    emitted: true,
    description: 'EXECUTION_POLICY_VERSION (interactive and delayed policy binding).',
  }),
  def({
    name: 'versions.policy_store',
    kind: 'gauge',
    unit: 'info',
    labels: {},
    snapshotPath: ['versions.policyStore'],
    emitted: true,
    description: 'Persisted policy_version (null when only the env seed is present).',
  }),
  def({
    name: 'versions.source_content_policy',
    kind: 'gauge',
    unit: 'info',
    labels: {},
    snapshotPath: ['versions.sourceContentPolicy'],
    emitted: true,
    description: 'SourceContentPolicy.policyVersion (source-content-policy).',
  }),
]

/** Every OperationsSnapshot field path a registered metric claims. */
export function registeredSnapshotPaths(): ReadonlySet<string> {
  return new Set(METRIC_DEFINITIONS.flatMap((d) => d.snapshotPath ?? []))
}

/** True when `value` is allowed for the label spec. */
export function labelValueAllowed(spec: LabelSpec, value: string): boolean {
  if ('values' in spec) return (spec.values as readonly string[]).includes(value)
  return spec.pattern.test(value)
}

// ── Log-field policy (executable data for the architecture gate) ──

/**
 * The ONLY identifier-shaped fields approved for log/trace/metric emission:
 * per-trace requestId and ADR 0030 event correlationId. Everything else that
 * names a tenant entity is banned from log objects (BANNED_LOG_KEYS below).
 */
export const APPROVED_CORRELATION_FIELDS = ['requestId', 'correlationId'] as const

/**
 * Keys that must never appear in a logger call-site object: tenant/entity
 * identifiers, raw payloads, protected content, and credential material.
 * jobName/queue/reason/duration/count/age/attempt fields are content-free
 * and stay approved (not listed). Calibrated against the BQC-7.3 call-site
 * sweep — a key lands here because a real call-site passed an identifier or
 * payload under it.
 */
const TENANT_IDENTIFIER_LOG_KEYS = [
  // Tenant/entity identifiers (and their in-code aliases)
  'organizationId',
  'orgId',
  'userId',
  'uid',
  'propertyId',
  'reviewId',
  'replyId',
  'jobId',
  'quarantineJobId',
  'eventId',
  'connectionId',
  'googleConnectionId',
  'inboxItemId',
  'noteId',
  'feedbackId',
  'portalId',
  'invitationId',
  'goalId',
  'notificationId',
  'notificationEmailId',
  'moveId',
  'resourceId',
  'id',
  // Generic payload containers are prohibited at log call-sites, but are not
  // sensitive field names by themselves (Sentry breadcrumbs legitimately use
  // `data` as a container whose children still require deep scrubbing).
  'jobData',
  'data',
  'input',
  'gbpAccountId',
] as const

export const BANNED_LOG_KEYS = [
  ...TENANT_IDENTIFIER_LOG_KEYS,
  ...SENSITIVE_OBSERVABILITY_FIELD_NAMES,
] as const

export type BannedLogKey = (typeof BANNED_LOG_KEYS)[number]

const BANNED_SET: ReadonlySet<string> = new Set(BANNED_LOG_KEYS)

export function isBannedLogKey(key: string): boolean {
  return BANNED_SET.has(key) || isSensitiveObservabilityField(key)
}
