// Health metrics — operational health for the outbox, queues, and content
// lifecycle (PRE17C / BQR-1.4).
//
// Provides a structured health snapshot that can be exposed via a health
// endpoint or scraped by a monitoring system. Metrics are identifier-only —
// no review content, PII, or provider data in any metric value (ADR 0030).
//
// BQC-3.7 alert substrate: claimed/stalled lease counters and quarantine
// depth join the existing unpublished/expired-lease signals; BQC-7.4 turns
// them into dispatched alerts (the health-check job evaluates the
// alert-definitions registry against this snapshot).
//
// Queries use the canonical Drizzle schema tables (single persistence model).
// Raw SQL fragments remain only for aggregate expressions; table/column
// identity comes from schema imports.

import { DEFAULT_LEASE_DURATION_MS, type OutboxRepository } from '#/shared/outbox'
import type { Database } from '#/shared/db'
import { sql } from 'drizzle-orm'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { reviews, replies } from '#/shared/db/schema/review.schema'
import { reviewSyncState } from '#/shared/db/schema/review-sync.schema'
import { notificationEmailQueue } from '#/shared/db/schema/notification.schema'
import { trace } from '#/shared/observability/trace'

/**
 * Minimal structural surface of the BullMQ quarantine queue used by the
 * metrics read (satisfied by bullmq Queue; trivial to fake in tests).
 * Signatures mirror BullMQ's own so a Queue assigns without a cast.
 */
export type QuarantineMetricsPort = Readonly<{
  getJobCounts: (
    ...types: import('bullmq').JobType[]
  ) => Promise<Partial<Record<string, number>>>
  getJobs: (
    types?: import('bullmq').JobType | import('bullmq').JobType[],
    start?: number,
    end?: number,
  ) => Promise<ReadonlyArray<{ data: unknown; timestamp?: number }>>
}>

export type HealthMetricsDeps = Readonly<{
  /** The BQC-3.6 dead-letter queue; quarantine metrics are null without it. */
  quarantineQueue?: QuarantineMetricsPort | null
  /**
   * Relay lease duration the stalled threshold derives from (stalled =
   * unexpired lease whose leased_at is older than 2× this). Defaults to the
   * outbox default lease.
   */
  leaseDurationMs?: number
  /**
   * GBP_PUBSUB_TOPIC is non-empty. Absent = treated as disabled, which is the
   * honest default: without the topic there is no push subscription.
   */
  gbpPushEnabled?: boolean
  /**
   * `notification.send_email` is globally enabled. Absent = treated as
   * disabled — outbound email is capability-dark, so a pending email backlog
   * is EXPECTED and must not page. A readiness fact the database cannot
   * answer, so the composition root supplies it (same shape as
   * gbpPushEnabled).
   */
  emailDeliveryEnabled?: boolean
  /**
   * How many recent inbox items have NO notification row (the
   * `notification.missing_for_inbox_item` gauge). The query belongs to the
   * notification context, and `src/shared/**` must never import
   * `src/contexts/**`, so the composition root injects the reader. Absent =
   * 0: a deployment without the wiring reports "no known gap" rather than
   * inventing one.
   */
  readMissingNotificationCount?: () => Promise<number>
  /**
   * Bounded, identifier-only Notification source→Redis→PostgreSQL lag read.
   * The owning context supplies it through composition; shared observability
   * receives only counts, clocks, and saturation evidence.
   */
  readNotificationDeliveryLag?: () => Promise<NotificationDeliveryLagRead>
}>

export type NotificationDeliveryLagRead = Readonly<{
  sourceReceiptPending: number
  materializationPending: number
  oldestSourceRecordedAt: Date | null
  oldestMaterializationSourceRecordedAt: Date | null
  oldestMaterializationEnqueuedAt: Date | null
  sourceSaturated: boolean
  materializationSaturated: boolean
  immediateEmailAcceptance: Readonly<{
    awaitingProviderAcceptance: number
    attemptedAwaitingProviderAcceptance: number
    oldestAwaitingSourceRecordedAt: Date | null
    acceptedLatencyP99Ms: number | null
    acceptedSampleCount: number
    sourceUnlinked: number
    saturated: boolean
  }>
}>

export type NotificationDeliveryLagMetrics = Readonly<{
  sourceReceiptPending: number
  materializationPending: number
  oldestSourceRecordedAt: string | null
  oldestSourceAgeMs: number | null
  oldestMaterializationSourceRecordedAt: string | null
  oldestMaterializationSourceAgeMs: number | null
  oldestMaterializationEnqueuedAt: string | null
  oldestMaterializationEnqueuedAgeMs: number | null
  sourceSaturated: boolean
  materializationSaturated: boolean
  immediateEmailAcceptance: Readonly<{
    awaitingProviderAcceptance: number
    attemptedAwaitingProviderAcceptance: number
    oldestAwaitingSourceRecordedAt: string | null
    oldestAwaitingSourceAgeMs: number | null
    acceptedLatencyP99Ms: number | null
    acceptedSampleCount: number
    sourceUnlinked: number
    saturated: boolean
  }>
}>

export type QuarantineMetrics = Readonly<{
  count: number
  oldestAgeMs: number | null
}>

export type HealthSnapshot = Readonly<{
  timestamp: string
  outbox: Readonly<{
    unpublishedCount: number
    oldestUnpublishedAgeMs: number | null
    expiredLeaseCount: number
    /** BQC-3.7: unpublished rows with an unexpired lease (in-flight claims). */
    claimedCount: number
    /** BQC-3.7: age of the oldest in-flight claim (from leased_at). */
    oldestClaimedAgeMs: number | null
    /** BQC-3.7: unexpired leases held longer than 2× the lease duration. */
    stalledLeaseCount: number
  }>
  quarantine: QuarantineMetrics | null
  reviews: Readonly<{
    totalActive: number
    refreshDueCount: number
    expiredCount: number
    oldestDueAgeSeconds: number | null
  }>
  sync: Readonly<{
    dueForIncrementalCount: number
    failedSyncCount: number
    /**
     * Age (ms) of the OLDEST past-due next_incremental_at — how far behind
     * the discovery sweep has fallen, not how many properties are waiting.
     * A count alone is unreadable: 100 properties that came due a minute ago
     * is a healthy sweep mid-run; one property due since yesterday means the
     * sweep is dead. Null when nothing is overdue.
     */
    oldestDueAgeMs: number | null
    /**
     * True when GBP_PUBSUB_TOPIC is configured. When false, Google push
     * notifications are DARK and a new review only reaches the app on the
     * discover-new-reviews sweep's cadence — a readiness fact, not a metric
     * the database can answer, so the composition root supplies it.
     */
    gbpPushEnabled: boolean
  }>
  /**
   * Notification delivery health. The in-app notification is written in the
   * same transaction as the review, but the EMAIL is a queue row a sweep has
   * to pick up — and nothing measured whether it ever did.
   */
  notifications: Readonly<{
    /**
     * `notification.send_email` is globally enabled. When false, outbound
     * email is intentionally dark and a pending backlog is the EXPECTED
     * state, not a fault — the stalled alert stays silent on it (see
     * attemptedStuckCount for the case that is a fault regardless).
     */
    emailDeliveryEnabled: boolean
    /** `pending` email rows whose due time (next_attempt_at → not_before →
     *  created_at) has already passed. */
    pendingOverdueCount: number
    /** Age of the oldest overdue pending row (null when none is overdue). */
    oldestPendingOverdueAgeMs: number | null
    /**
     * Overdue pending rows the delivery path ALREADY TOUCHED (attempted_at
     * set). Unlike the count above this cannot be explained by a dark
     * capability — the sweep reached the row, tried, and left it pending. It
     * is the honest break signal for a per-org-allowlisted tenant, whose
     * grant the global emailDeliveryEnabled flag cannot see.
     */
    attemptedStuckCount: number
    /**
     * Inbox items created inside the reconciliation window (past the grace
     * edge) with NO notification row for anybody — "a review arrived and
     * nobody was told". Above zero means either the in-process fan-out
     * dropped it and the reconcile-missing-notifications sweep has not caught
     * up, or the sweep itself is not running. Saturates at the sweep's scan
     * cap; the alert on it fires on "above zero", so the cap costs nothing.
     */
    missingForInboxItemCount: number
    /** Bounded end-to-end delivery evidence for every active beta family. */
    deliveryLag: NotificationDeliveryLagMetrics
  }>
  /**
   * BQC-7.3 (reply.publication.*): durable publication-state counts (the
   * migration-0015 state machine) + the reconciliation backlog age. Counts
   * cover the full CHECK-constraint state set; NULL publication_state rows
   * (drafts / pre-0015 legacy) are not a publication workflow and are not
   * counted.
   */
  replyPublication: Readonly<{
    counts: Readonly<Record<string, number>>
    /** Age of the oldest ambiguous row past its reconcile_due_at (null when
     *  no ambiguous row is due — the sweep is keeping up). */
    oldestAmbiguousAgeMs: number | null
  }>
  workers: Readonly<{
    defaultQueueName: string
    backgroundQueueName: string
    domainEventsQueueName: string
  }>
}>

export type HealthChecker = Readonly<{
  check: () => Promise<HealthSnapshot>
}>

/**
 * Bounded scan for the expired-lease signal — an exact count is unnecessary
 * for alerting: a four-digit expired-lease backlog already reads as an
 * incident. This is findExpiredLeases' caller (it was dead code before 3.7).
 */
const EXPIRED_LEASE_SCAN_LIMIT = 1000

/** Bounded scan for quarantine age — the quarantine is operator-drained. */
const QUARANTINE_AGE_SCAN_LIMIT = 100

type OutboxMetrics = HealthSnapshot['outbox']

async function readOutboxMetrics(
  db: Database,
  repo: OutboxRepository,
  leaseDurationMs: number,
): Promise<OutboxMetrics> {
  const unpublishedResult = await db
    .select({
      cnt: sql<number>`count(*)::int`,
      age_ms: sql<number | null>`
        EXTRACT(EPOCH FROM (NOW() - MIN(${outboxEvents.createdAt}))) * 1000
      `,
    })
    .from(outboxEvents)
    .where(sql`${outboxEvents.publishedAt} IS NULL`)

  const unpublishedRow = unpublishedResult[0]

  // Expired-lease signal via the repository (ownership of the predicate lives
  // in one place). Bounded — see EXPIRED_LEASE_SCAN_LIMIT.
  const expiredRows = await repo.findExpiredLeases(EXPIRED_LEASE_SCAN_LIMIT)

  // Claimed + stalled: an unexpired lease marks an in-flight claim; a lease
  // held beyond 2× its duration without publishing is stalled (the relay
  // renews mid-batch, so a healthy claim never approaches that age).
  const stalledThreshold = new Date(Date.now() - 2 * leaseDurationMs)
  const claimedResult = await db
    .select({
      claimed: sql<number>`
        count(*) FILTER (WHERE ${outboxEvents.leaseExpiresAt} > NOW())::int
      `,
      oldest_claimed_age_ms: sql<number | null>`
        EXTRACT(EPOCH FROM (NOW() - MIN(${outboxEvents.leasedAt}) FILTER (
          WHERE ${outboxEvents.leaseExpiresAt} > NOW()
        ))) * 1000
      `,
      stalled: sql<number>`
        count(*) FILTER (
          WHERE ${outboxEvents.leaseExpiresAt} > NOW()
            AND ${outboxEvents.leasedAt} < ${stalledThreshold}
        )::int
      `,
    })
    .from(outboxEvents)
    .where(sql`${outboxEvents.publishedAt} IS NULL`)

  const claimedRow = claimedResult[0]

  return {
    unpublishedCount: unpublishedRow?.cnt ?? 0,
    oldestUnpublishedAgeMs:
      unpublishedRow?.age_ms != null ? Math.round(Number(unpublishedRow.age_ms)) : null,
    expiredLeaseCount: expiredRows.length,
    claimedCount: claimedRow?.claimed ?? 0,
    oldestClaimedAgeMs:
      claimedRow?.oldest_claimed_age_ms != null
        ? Math.round(Number(claimedRow.oldest_claimed_age_ms))
        : null,
    stalledLeaseCount: claimedRow?.stalled ?? 0,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readQuarantineMetrics(
  queue: QuarantineMetricsPort,
  now: Date,
): Promise<QuarantineMetrics> {
  // The quarantine queue has no worker — jobs sit in waiting/delayed.
  const counts = await queue.getJobCounts('waiting', 'delayed', 'prioritized')
  const count = (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.prioritized ?? 0)

  const jobs = await queue.getJobs(
    ['waiting', 'delayed', 'prioritized'],
    0,
    QUARANTINE_AGE_SCAN_LIMIT - 1,
  )
  let oldestAgeMs: number | null = null
  for (const job of jobs) {
    const quarantinedAt =
      isRecord(job.data) && typeof job.data.quarantinedAt === 'string'
        ? Date.parse(job.data.quarantinedAt)
        : job.timestamp
    if (quarantinedAt == null || Number.isNaN(quarantinedAt)) continue
    const ageMs = now.getTime() - quarantinedAt
    if (oldestAgeMs == null || ageMs > oldestAgeMs) oldestAgeMs = ageMs
  }

  return { count, oldestAgeMs }
}

type ReplyPublicationMetrics = HealthSnapshot['replyPublication']

/**
 * BQC-7.3: reply publication-state counts + ambiguity reconciliation age
 * (replies table, migration 0015). NULL publication_state rows (drafts /
 * pre-0015 legacy) are not a publication workflow and are not counted.
 */
async function readReplyPublicationMetrics(
  db: Database,
): Promise<ReplyPublicationMetrics> {
  const result = await db
    .select({
      requested: sql<number>`
        count(*) FILTER (WHERE ${replies.publicationState} = 'requested')::int
      `,
      authorized: sql<number>`
        count(*) FILTER (WHERE ${replies.publicationState} = 'authorized')::int
      `,
      sending: sql<number>`
        count(*) FILTER (WHERE ${replies.publicationState} = 'sending')::int
      `,
      published: sql<number>`
        count(*) FILTER (WHERE ${replies.publicationState} = 'published')::int
      `,
      terminal: sql<number>`
        count(*) FILTER (WHERE ${replies.publicationState} = 'terminal')::int
      `,
      ambiguous: sql<number>`
        count(*) FILTER (WHERE ${replies.publicationState} = 'ambiguous')::int
      `,
      cancelled: sql<number>`
        count(*) FILTER (WHERE ${replies.publicationState} = 'cancelled')::int
      `,
      oldest_ambiguous_age_ms: sql<number | null>`
        EXTRACT(EPOCH FROM (NOW() - MIN(${replies.reconcileDueAt}) FILTER (
          WHERE ${replies.publicationState} = 'ambiguous'
            AND ${replies.reconcileDueAt} IS NOT NULL
            AND ${replies.reconcileDueAt} < NOW()
        ))) * 1000
      `,
    })
    .from(replies)

  const row = result[0]
  return {
    counts: {
      requested: row?.requested ?? 0,
      authorized: row?.authorized ?? 0,
      sending: row?.sending ?? 0,
      published: row?.published ?? 0,
      terminal: row?.terminal ?? 0,
      ambiguous: row?.ambiguous ?? 0,
      cancelled: row?.cancelled ?? 0,
    },
    oldestAmbiguousAgeMs:
      row?.oldest_ambiguous_age_ms != null
        ? Math.round(Number(row.oldest_ambiguous_age_ms))
        : null,
  }
}

/**
 * The EMAIL half of the notifications block. `missingForInboxItemCount` is
 * deliberately excluded: it comes from the notification context through an
 * injected reader, not from this file's `notification_email_queue` query, and
 * the caller composes the two.
 */
type NotificationEmailMetrics = Omit<
  HealthSnapshot['notifications'],
  'missingForInboxItemCount' | 'deliveryLag'
>

/**
 * Notification email queue health: how many queued emails are past their due
 * time, how far past, and how many of those the delivery path already tried.
 *
 * Due time is `next_attempt_at` (a scheduled retry) → `not_before` (a cadence
 * hold) → `created_at` (send as soon as the sweep gets to it). The threshold
 * lives in the alert definition, not here: this read reports the age, the
 * policy decides what age is too old.
 */
async function readNotificationEmailMetrics(
  db: Database,
  emailDeliveryEnabled: boolean,
): Promise<NotificationEmailMetrics> {
  const dueAt = sql`COALESCE(
    ${notificationEmailQueue.nextAttemptAt},
    ${notificationEmailQueue.notBefore},
    ${notificationEmailQueue.createdAt}
  )`
  const overdue = sql`${notificationEmailQueue.status} = 'pending' AND ${dueAt} < NOW()`

  const result = await db
    .select({
      overdue: sql<number>`count(*) FILTER (WHERE ${overdue})::int`,
      oldest_overdue_age_ms: sql<number | null>`
        EXTRACT(EPOCH FROM (NOW() - MIN(${dueAt}) FILTER (WHERE ${overdue}))) * 1000
      `,
      attempted: sql<number>`
        count(*) FILTER (
          WHERE ${overdue} AND ${notificationEmailQueue.attemptedAt} IS NOT NULL
        )::int
      `,
    })
    .from(notificationEmailQueue)

  const row = result[0]
  return {
    emailDeliveryEnabled,
    pendingOverdueCount: row?.overdue ?? 0,
    oldestPendingOverdueAgeMs:
      row?.oldest_overdue_age_ms != null
        ? Math.round(Number(row.oldest_overdue_age_ms))
        : null,
    attemptedStuckCount: row?.attempted ?? 0,
  }
}

const EMPTY_NOTIFICATION_DELIVERY_LAG: NotificationDeliveryLagRead = {
  sourceReceiptPending: 0,
  materializationPending: 0,
  oldestSourceRecordedAt: null,
  oldestMaterializationSourceRecordedAt: null,
  oldestMaterializationEnqueuedAt: null,
  sourceSaturated: false,
  materializationSaturated: false,
  immediateEmailAcceptance: {
    awaitingProviderAcceptance: 0,
    attemptedAwaitingProviderAcceptance: 0,
    oldestAwaitingSourceRecordedAt: null,
    acceptedLatencyP99Ms: null,
    acceptedSampleCount: 0,
    sourceUnlinked: 0,
    saturated: false,
  },
}

const lagClock = (
  value: Date | null,
  now: Date,
): Readonly<{ at: string | null; ageMs: number | null }> => {
  if (value === null || !Number.isFinite(value.getTime())) {
    return { at: null, ageMs: null }
  }
  return {
    at: value.toISOString(),
    ageMs: Math.max(0, now.getTime() - value.getTime()),
  }
}

/** Select only the allowlisted operational fields from the injected report. */
const readNotificationDeliveryLagMetrics = async (
  read: (() => Promise<NotificationDeliveryLagRead>) | undefined,
  now: Date,
): Promise<NotificationDeliveryLagMetrics> => {
  const report = read ? await read() : EMPTY_NOTIFICATION_DELIVERY_LAG
  const source = lagClock(report.oldestSourceRecordedAt, now)
  const materializationSource = lagClock(
    report.oldestMaterializationSourceRecordedAt,
    now,
  )
  const materializationEnqueued = lagClock(report.oldestMaterializationEnqueuedAt, now)
  const oldestAwaitingEmailSource = lagClock(
    report.immediateEmailAcceptance.oldestAwaitingSourceRecordedAt,
    now,
  )
  return {
    sourceReceiptPending: report.sourceReceiptPending,
    materializationPending: report.materializationPending,
    oldestSourceRecordedAt: source.at,
    oldestSourceAgeMs: source.ageMs,
    oldestMaterializationSourceRecordedAt: materializationSource.at,
    oldestMaterializationSourceAgeMs: materializationSource.ageMs,
    oldestMaterializationEnqueuedAt: materializationEnqueued.at,
    oldestMaterializationEnqueuedAgeMs: materializationEnqueued.ageMs,
    sourceSaturated: report.sourceSaturated,
    materializationSaturated: report.materializationSaturated,
    immediateEmailAcceptance: {
      awaitingProviderAcceptance:
        report.immediateEmailAcceptance.awaitingProviderAcceptance,
      attemptedAwaitingProviderAcceptance:
        report.immediateEmailAcceptance.attemptedAwaitingProviderAcceptance,
      oldestAwaitingSourceRecordedAt: oldestAwaitingEmailSource.at,
      oldestAwaitingSourceAgeMs: oldestAwaitingEmailSource.ageMs,
      acceptedLatencyP99Ms:
        report.immediateEmailAcceptance.acceptedLatencyP99Ms === null ||
        !Number.isFinite(report.immediateEmailAcceptance.acceptedLatencyP99Ms)
          ? null
          : Math.max(0, report.immediateEmailAcceptance.acceptedLatencyP99Ms),
      acceptedSampleCount: report.immediateEmailAcceptance.acceptedSampleCount,
      sourceUnlinked: report.immediateEmailAcceptance.sourceUnlinked,
      saturated: report.immediateEmailAcceptance.saturated,
    },
  }
}

/**
 * Review content lifecycle health: how many reviews carry a content expiry,
 * how many are inside the refresh window, how many already expired, and how
 * close the nearest hard expiry is (columns from migration 0006 / Drizzle).
 */
async function readReviewContentMetrics(
  db: Database,
): Promise<HealthSnapshot['reviews']> {
  const result = await db
    .select({
      total: sql<number>`
        count(*) FILTER (WHERE ${reviews.contentExpiresAt} IS NOT NULL)::int
      `,
      refresh_due: sql<number>`
        count(*) FILTER (
          WHERE ${reviews.contentExpiresAt} IS NOT NULL
            AND ${reviews.lastFetchedAt} IS NOT NULL
            AND NOW() > (${reviews.lastFetchedAt} + INTERVAL '25 days')
        )::int
      `,
      expired: sql<number>`
        count(*) FILTER (
          WHERE ${reviews.contentExpiresAt} IS NOT NULL
            AND ${reviews.contentExpiresAt} < NOW()
        )::int
      `,
      // BQC-1.5: oldest refresh-due expiry age (seconds until the
      // nearest hard expiry among refresh-due rows; alert input for
      // "before the policy deadline"). NULL when nothing is due.
      oldest_due_age_seconds: sql<number>`
        extract(epoch from (
          min(${reviews.contentExpiresAt}) FILTER (
            WHERE ${reviews.contentExpiresAt} IS NOT NULL
              AND ${reviews.lastFetchedAt} IS NOT NULL
              AND NOW() > (${reviews.lastFetchedAt} + INTERVAL '25 days')
              AND ${reviews.contentExpiresAt} >= NOW()
          ) - NOW()
        ))::int
      `,
    })
    .from(reviews)

  const row = result[0]
  return {
    totalActive: row?.total ?? 0,
    refreshDueCount: row?.refresh_due ?? 0,
    expiredCount: row?.expired ?? 0,
    /** BQC-1.5: seconds until the nearest hard expiry among
     *  refresh-due rows (null when nothing is due). */
    oldestDueAgeSeconds: row?.oldest_due_age_seconds ?? null,
  }
}

/**
 * Discovery sweep health: how many properties are past their poll time, how
 * many are in error backoff, and how far behind the sweep has fallen
 * (migration 0007 / Drizzle).
 *
 * `gbpPushEnabled` is a readiness fact the database cannot answer, so the
 * composition root supplies it — threaded through here the same way
 * `emailDeliveryEnabled` is threaded through the notification-email read.
 */
async function readSyncStateMetrics(
  db: Database,
  gbpPushEnabled: boolean,
): Promise<HealthSnapshot['sync']> {
  const result = await db
    .select({
      due: sql<number>`
        count(*) FILTER (
          WHERE ${reviewSyncState.nextIncrementalAt} IS NOT NULL
            AND ${reviewSyncState.nextIncrementalAt} < NOW()
        )::int
      `,
      failed: sql<number>`
        count(*) FILTER (
          WHERE ${reviewSyncState.errorClass} IS NOT NULL
            AND ${reviewSyncState.errorRetryAt} IS NOT NULL
            AND ${reviewSyncState.errorRetryAt} < NOW()
        )::int
      `,
      // How far behind the discovery sweep is: the age of the oldest
      // past-due poll time. next_incremental_at is always written in
      // the future by the sync/backoff path, so a positive age here is
      // purely sweep lag (the poll interval is already priced in).
      oldest_due_age_ms: sql<number | null>`
        EXTRACT(EPOCH FROM (NOW() - MIN(${reviewSyncState.nextIncrementalAt}) FILTER (
          WHERE ${reviewSyncState.nextIncrementalAt} IS NOT NULL
            AND ${reviewSyncState.nextIncrementalAt} < NOW()
        ))) * 1000
      `,
    })
    .from(reviewSyncState)

  const row = result[0]
  return {
    dueForIncrementalCount: row?.due ?? 0,
    failedSyncCount: row?.failed ?? 0,
    oldestDueAgeMs:
      row?.oldest_due_age_ms != null ? Math.round(Number(row.oldest_due_age_ms)) : null,
    gbpPushEnabled,
  }
}

/**
 * Create a health checker that queries operational metrics from the database.
 */
export function createHealthChecker(
  db: Database,
  outboxRepo?: OutboxRepository,
  deps?: HealthMetricsDeps,
): HealthChecker {
  return {
    check: async () => {
      return trace('health.check', async () => {
        const now = new Date()

        // Outbox metrics (only if outbox repo is available)
        const outboxMetrics: OutboxMetrics = outboxRepo
          ? await readOutboxMetrics(
              db,
              outboxRepo,
              deps?.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS,
            )
          : {
              unpublishedCount: 0,
              oldestUnpublishedAgeMs: null,
              expiredLeaseCount: 0,
              claimedCount: 0,
              oldestClaimedAgeMs: null,
              stalledLeaseCount: 0,
            }

        const quarantineMetrics = deps?.quarantineQueue
          ? await readQuarantineMetrics(deps.quarantineQueue, now)
          : null

        // Review content lifecycle metrics (columns from migration 0006 / Drizzle)
        const reviewMetrics = await readReviewContentMetrics(db)

        // Sync state metrics (migration 0007 / Drizzle)
        const syncMetrics = await readSyncStateMetrics(db, deps?.gbpPushEnabled === true)

        // BQC-7.3: reply publication-state counts + ambiguity age (0015).
        const replyPublication = await readReplyPublicationMetrics(db)

        // Notification delivery health: is the queued email actually going out?
        const notificationEmail = await readNotificationEmailMetrics(
          db,
          deps?.emailDeliveryEnabled === true,
        )
        // Notification EXISTENCE health: did the in-app notification get
        // written at all? Injected because the query lives in the
        // notification context (see readMissingNotificationCount).
        const [missingForInboxItemCount, deliveryLag] = await Promise.all([
          deps?.readMissingNotificationCount
            ? deps.readMissingNotificationCount()
            : Promise.resolve(0),
          readNotificationDeliveryLagMetrics(deps?.readNotificationDeliveryLag, now),
        ])
        const notifications = {
          ...notificationEmail,
          missingForInboxItemCount,
          deliveryLag,
        }

        return {
          timestamp: now.toISOString(),
          outbox: outboxMetrics,
          quarantine: quarantineMetrics,
          reviews: reviewMetrics,
          sync: syncMetrics,
          notifications,
          replyPublication,
          workers: {
            defaultQueueName: 'default',
            backgroundQueueName: 'background',
            domainEventsQueueName: 'domain-events',
          },
        }
      })
    },
  }
}
