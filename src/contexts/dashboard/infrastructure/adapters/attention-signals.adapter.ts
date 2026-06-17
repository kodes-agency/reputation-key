// Dashboard context — Drizzle adapter implementing AttentionSignalsPort.
// Count queries for the property attention band.
// This is the ONLY place dashboard infrastructure touches reviews/replies,
// inbox_items, and goals tables for attention-signal purposes (ADR-0007).

import type { Database } from '#/shared/db'
import { reviews, replies, inboxItems, goals, goalProgress } from '#/shared/db/schema'
import { and, count, eq, sql, lt } from 'drizzle-orm'
import { trace } from '#/shared/observability/trace'
import type { AttentionSignalsPort } from '../../application/ports/attention-signals.port'

const MS_PER_HOUR = 3_600_000

export function createAttentionSignalsAdapter(db: Database): AttentionSignalsPort {
  return {
    async getUnansweredReviewCount(organizationId, propertyId, slaHours) {
      return trace('dashboard.attention.unansweredReviews', async () => {
        // Past SLA: reviewed earlier than now − slaHours (ms-per-hour conversion).
        const cutoff = new Date(Date.now() - slaHours * MS_PER_HOUR)
        const rows = await db
          .select({ count: count() })
          .from(reviews)
          .where(
            and(
              eq(reviews.organizationId, organizationId),
              eq(reviews.propertyId, propertyId),
              lt(reviews.reviewedAt, cutoff),
              // No published reply yet — the customer has not been answered.
              sql`NOT EXISTS (
                SELECT 1 FROM ${replies}
                WHERE ${replies.reviewId} = ${reviews.id}
                  AND ${replies.organizationId} = ${organizationId}
                  AND ${replies.status} = 'published'
              )`,
            ),
          )
        return Number(rows[0]?.count ?? 0)
      })
    },

    async getNewInboxItemCount(organizationId, propertyId) {
      return trace('dashboard.attention.newInboxItems', async () => {
        const rows = await db
          .select({ count: count() })
          .from(inboxItems)
          .where(
            and(
              eq(inboxItems.organizationId, organizationId),
              eq(inboxItems.propertyId, propertyId),
              eq(inboxItems.status, 'new'),
            ),
          )
        return Number(rows[0]?.count ?? 0)
      })
    },

    async getEscalatedInboxItemCount(organizationId, propertyId) {
      return trace('dashboard.attention.escalatedInboxItems', async () => {
        const rows = await db
          .select({ count: count() })
          .from(inboxItems)
          .where(
            and(
              eq(inboxItems.organizationId, organizationId),
              eq(inboxItems.propertyId, propertyId),
              eq(inboxItems.status, 'escalated'),
            ),
          )
        return Number(rows[0]?.count ?? 0)
      })
    },

    async getGoalsBehindPaceCount(organizationId, propertyId) {
      return trace('dashboard.attention.goalsBehindPace', async () => {
        // Behind pace = current value < pro-rated expected value for elapsed time.
        // Only bounded, active, not-yet-ended goals are pro-ratable.
        const rows = await db
          .select({ count: count() })
          .from(goals)
          .leftJoin(
            goalProgress,
            and(
              eq(goalProgress.goalId, goals.id),
              eq(goalProgress.organizationId, organizationId),
            ),
          )
          .where(
            and(
              eq(goals.organizationId, organizationId),
              eq(goals.propertyId, propertyId),
              eq(goals.status, 'active'),
              sql`${goals.periodStart} IS NOT NULL`,
              sql`${goals.periodEnd} IS NOT NULL`,
              sql`${goals.periodEnd} > now()`,
              sql`COALESCE(${goalProgress.currentValue}, 0) < ${goals.targetValue} *
                GREATEST(0, LEAST(1,
                  EXTRACT(EPOCH FROM (now() - ${goals.periodStart}))
                  / NULLIF(EXTRACT(EPOCH FROM (${goals.periodEnd} - ${goals.periodStart})), 0)
                ))`,
            ),
          )
        return Number(rows[0]?.count ?? 0)
      })
    },
  }
}
