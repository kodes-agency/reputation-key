// Health metrics — operational health for the outbox, queues, and content
// lifecycle (PRE17C / BQR-1.4).
//
// Provides a structured health snapshot that can be exposed via a health
// endpoint or scraped by a monitoring system. Metrics are identifier-only —
// no review content, PII, or provider data in any metric value (ADR 0030).
//
// Queries use the canonical Drizzle schema tables (single persistence model).
// Raw SQL fragments remain only for aggregate expressions; table/column
// identity comes from schema imports.

import type { OutboxRepository } from '#/shared/outbox'
import type { Database } from '#/shared/db'
import { sql } from 'drizzle-orm'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { reviews } from '#/shared/db/schema/review.schema'
import { reviewSyncState } from '#/shared/db/schema/review-sync.schema'
import { trace } from '#/shared/observability/trace'

export type HealthSnapshot = Readonly<{
  timestamp: string
  outbox: Readonly<{
    unpublishedCount: number
    oldestUnpublishedAgeMs: number | null
    expiredLeaseCount: number
  }>
  reviews: Readonly<{
    totalActive: number
    refreshDueCount: number
    expiredCount: number
  }>
  sync: Readonly<{
    dueForIncrementalCount: number
    failedSyncCount: number
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
 * Create a health checker that queries operational metrics from the database.
 */
export function createHealthChecker(
  db: Database,
  outboxRepo?: OutboxRepository,
): HealthChecker {
  return {
    check: async () => {
      return trace('health.check', async () => {
        const now = new Date()

        // Outbox metrics (only if outbox repo is available)
        let outboxMetrics = {
          unpublishedCount: 0,
          oldestUnpublishedAgeMs: null as number | null,
          expiredLeaseCount: 0,
        }

        if (outboxRepo) {
          const unpublishedResult = await db
            .select({
              cnt: sql<number>`count(*)::int`,
              age_ms: sql<number | null>`
                EXTRACT(EPOCH FROM (NOW() - MIN(${outboxEvents.createdAt}))) * 1000
              `,
            })
            .from(outboxEvents)
            .where(sql`${outboxEvents.publishedAt} IS NULL`)

          const row = unpublishedResult[0]
          if (row) {
            outboxMetrics = {
              unpublishedCount: row.cnt,
              oldestUnpublishedAgeMs:
                row.age_ms != null ? Math.round(Number(row.age_ms)) : null,
              expiredLeaseCount: 0,
            }
          }

          const expiredResult = await db
            .select({
              cnt: sql<number>`count(*)::int`,
            })
            .from(outboxEvents)
            .where(
              sql`${outboxEvents.publishedAt} IS NULL
                AND ${outboxEvents.leaseExpiresAt} IS NOT NULL
                AND ${outboxEvents.leaseExpiresAt} < NOW()`,
            )

          const expiredRow = expiredResult[0]
          if (expiredRow) {
            outboxMetrics.expiredLeaseCount = expiredRow.cnt
          }
        }

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

        return {
          timestamp: now.toISOString(),
          outbox: outboxMetrics,
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
