// Dashboard context — Drizzle adapter implementing AttentionSignalsPort.
// Count queries for the property attention band.
// This is the ONLY place dashboard infrastructure touches reviews/replies,
// inbox_items, and goals tables for attention-signal purposes (ADR-0007).
// BQC-5.5: scope predicates and the statement timeout come from the read
// facade. The review-reading count applies THE source-eligibility predicate
// (ADR 0031) — an unanswered count over expired content is not servable.

import type { Database } from '#/shared/db'
import { reviews, replies, inboxItems, goals, goalProgress } from '#/shared/db/schema'
import { and, count, eq, sql, lt, isNull } from 'drizzle-orm'
import { trace } from '#/shared/observability/trace'
import type { AttentionSignalsPort } from '../../application/ports/attention-signals.port'
import { slaCutoff } from '../../application/utils'
import type { Clock } from '#/shared/domain/clock'
import {
  DASHBOARD_READ_BUDGET_MS,
  eligibleAttentionReviewWhere,
  goalScopeWhere,
  inboxScopeWhere,
  readInboxItemCount,
  withStatementTimeout,
} from '../read-facade'

export const createAttentionSignalsAdapter = (
  db: Database,
  clock: Clock,
): AttentionSignalsPort => ({
  async getUnansweredReviewCount(organizationId, propertyId, slaHours) {
    return trace('dashboard.attention.unansweredReviews', async () => {
      // Past SLA: reviewed earlier than clock() − slaHours. Clock injected (ADR 0017).
      const now = clock()
      const cutoff = slaCutoff(now, slaHours)
      const rows = await withStatementTimeout(db, DASHBOARD_READ_BUDGET_MS, (tx) =>
        tx
          .select({ count: count() })
          .from(reviews)
          .where(
            and(
              // BQC-5.5: eligible content only (ADR 0031) — expired or
              // clock-less reviews are not servable, answered or not.
              eligibleAttentionReviewWhere(organizationId, propertyId, now),
              lt(reviews.reviewedAt, cutoff),
              // No published reply yet — the customer has not been answered.
              sql`NOT EXISTS (
                SELECT 1 FROM ${replies}
                WHERE ${replies.reviewId} = ${reviews.id}
                  AND ${replies.organizationId} = ${organizationId}
                  AND ${replies.status} = 'published'
              )`,
            ),
          ),
      )
      return Number(rows[0]?.count ?? 0)
    })
  },

  async getNewInboxItemCount(organizationId, propertyId) {
    return trace('dashboard.attention.newInboxItems', () =>
      readInboxItemCount(
        db,
        and(inboxScopeWhere(organizationId, propertyId), eq(inboxItems.status, 'open')),
      ),
    )
  },

  async getEscalatedInboxItemCount(organizationId, propertyId) {
    return trace('dashboard.attention.escalatedInboxItems', () =>
      readInboxItemCount(
        db,
        and(
          inboxScopeWhere(organizationId, propertyId),
          eq(inboxItems.isEscalated, true),
          isNull(inboxItems.escalationResolvedAt),
        ),
      ),
    )
  },

  async getGoalsBehindPaceCount(organizationId, propertyId) {
    return trace('dashboard.attention.goalsBehindPace', async () => {
      // Behind pace = current value < pro-rated expected value for elapsed time.
      // Only bounded, active, not-yet-ended goals are pro-ratable.
      const now = clock()
      const rows = await withStatementTimeout(db, DASHBOARD_READ_BUDGET_MS, (tx) =>
        tx
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
              goalScopeWhere(organizationId, propertyId),
              eq(goals.status, 'active'),
              sql`${goals.periodStart} IS NOT NULL`,
              sql`${goals.periodEnd} IS NOT NULL`,
              sql`${goals.periodEnd} > ${now}`,
              sql`COALESCE(${goalProgress.currentValue}, 0) < ${goals.targetValue} *
                GREATEST(0, LEAST(1,
                  EXTRACT(EPOCH FROM (${now} - ${goals.periodStart}))
                  / NULLIF(EXTRACT(EPOCH FROM (${goals.periodEnd} - ${goals.periodStart})), 0)
                ))`,
            ),
          ),
      )
      return Number(rows[0]?.count ?? 0)
    })
  },
})
