// Health metrics — operational health for the outbox, queues, and content
// lifecycle (PRE17C).
//
// Provides a structured health snapshot that can be exposed via a health
// endpoint or scraped by a monitoring system. Metrics are identifier-only —
// no review content, PII, or provider data in any metric value.

import type { OutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import type { Database } from '#/shared/db'
import { sql } from 'drizzle-orm'
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
          // Count unpublished events
          const unpublishedResult = await db.execute(sql`
            SELECT count(*)::int AS cnt,
                   EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) * 1000 AS age_ms
            FROM outbox_events WHERE published_at IS NULL
          `)
          const row = unpublishedResult.rows[0] as
            | { cnt: number; age_ms: number | null }
            | undefined
          if (row) {
            outboxMetrics = {
              unpublishedCount: row.cnt,
              oldestUnpublishedAgeMs: row.age_ms ? Math.round(row.age_ms) : null,
              expiredLeaseCount: 0,
            }
          }

          // Count expired leases
          const expiredResult = await db.execute(sql`
            SELECT count(*)::int AS cnt FROM outbox_events
            WHERE published_at IS NULL AND lease_expires_at IS NOT NULL AND lease_expires_at < NOW()
          `)
          const expiredRow = expiredResult.rows[0] as { cnt: number } | undefined
          if (expiredRow) {
            outboxMetrics.expiredLeaseCount = expiredRow.cnt
          }
        }

        // Review content lifecycle metrics
        const reviewResult = await db.execute(sql`
          SELECT
            count(*) FILTER (WHERE content_expires_at IS NOT NULL)::int AS total,
            count(*) FILTER (WHERE content_expires_at IS NOT NULL
              AND last_fetched_at IS NOT NULL
              AND NOW() > (last_fetched_at + INTERVAL '25 days'))::int AS refresh_due,
            count(*) FILTER (WHERE content_expires_at IS NOT NULL
              AND content_expires_at < NOW())::int AS expired
          FROM reviews
        `)
        const reviewRow = reviewResult.rows[0] as
          | { total: number; refresh_due: number; expired: number }
          | undefined

        // Sync state metrics
        const syncResult = await db.execute(sql`
          SELECT
            count(*) FILTER (WHERE next_incremental_at IS NOT NULL AND next_incremental_at < NOW())::int AS due,
            count(*) FILTER (WHERE error_class IS NOT NULL AND error_retry_at IS NOT NULL AND error_retry_at < NOW())::int AS failed
          FROM review_sync_state
        `)
        const syncRow = syncResult.rows[0] as { due: number; failed: number } | undefined

        return {
          timestamp: now.toISOString(),
          outbox: outboxMetrics,
          reviews: {
            totalActive: reviewRow?.total ?? 0,
            refreshDueCount: reviewRow?.refresh_due ?? 0,
            expiredCount: reviewRow?.expired ?? 0,
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
