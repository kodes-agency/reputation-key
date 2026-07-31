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

import type { OutboxRepository } from '#/shared/outbox'
import { DEFAULT_LEASE_DURATION_MS } from '#/shared/outbox/infrastructure/outbox-repository'
import type { Database } from '#/shared/db'
import { sql } from 'drizzle-orm'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { reviews, replies } from '#/shared/db/schema/review.schema'
import { reviewSyncState } from '#/shared/db/schema/review-sync.schema'
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
        const reviewResult = await db
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

        const reviewRow = reviewResult[0]

        // Sync state metrics (migration 0007 / Drizzle)
        const syncResult = await db
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
          })
          .from(reviewSyncState)

        const syncRow = syncResult[0]

        // BQC-7.3: reply publication-state counts + ambiguity age (0015).
        const replyPublication = await readReplyPublicationMetrics(db)

        return {
          timestamp: now.toISOString(),
          outbox: outboxMetrics,
          quarantine: quarantineMetrics,
          reviews: {
            totalActive: reviewRow?.total ?? 0,
            refreshDueCount: reviewRow?.refresh_due ?? 0,
            expiredCount: reviewRow?.expired ?? 0,
            /** BQC-1.5: seconds until the nearest hard expiry among
             *  refresh-due rows (null when nothing is due). */
            oldestDueAgeSeconds: reviewRow?.oldest_due_age_seconds ?? null,
          },
          sync: {
            dueForIncrementalCount: syncRow?.due ?? 0,
            failedSyncCount: syncRow?.failed ?? 0,
          },
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
