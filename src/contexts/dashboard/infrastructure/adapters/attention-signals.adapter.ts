// Dashboard context — Drizzle adapter implementing AttentionSignalsPort.
// Count queries for the property attention band.
// This is the ONLY place dashboard infrastructure touches reviews/replies,
// inbox_items, and canonical Goal Program results for attention-signal
// purposes (ADR-0007).
// BQC-5.5: scope predicates and the statement timeout come from the read
// facade. The review-reading count applies THE source-eligibility predicate
// (ADR 0031) — an unanswered count over expired content is not servable.

import type { Database } from '#/shared/db'
import {
  goalMonthlyResults,
  goalPrograms,
  goalProgramVersions,
  inboxItems,
  replies,
  reviews,
} from '#/shared/db/schema'
import { sql, lt } from 'drizzle-orm'
import { trace } from '#/shared/observability/trace'
import type { AttentionSignalsPort } from '../../application/ports/attention-signals.port'
import { slaCutoff } from '../../application/utils'
import type { Clock } from '#/shared/domain/clock'
import {
  DASHBOARD_READ_BUDGET_MS,
  eligibleAttentionReviewWhere,
  inboxScopeWhere,
  withStatementTimeout,
} from '../read-facade'

export const createAttentionSignalsAdapter = (
  db: Database,
  clock: Clock,
): AttentionSignalsPort => ({
  async getAttentionCounts(organizationId, propertyId, slaHours) {
    return trace('dashboard.attention.counts', async () => {
      // One clock read and one statement keep all overlapping reasons on the
      // same snapshot while preserving the injected-time rule (ADR 0017).
      const now = clock()
      const cutoff = slaCutoff(now, slaHours)
      const result = await withStatementTimeout(db, DASHBOARD_READ_BUDGET_MS, (tx) =>
        tx.execute(sql`
          WITH unanswered_review_work AS MATERIALIZED (
            SELECT 'review:' || ${reviews.id}::text AS work_key
            FROM ${reviews}
            WHERE ${eligibleAttentionReviewWhere(organizationId, propertyId, now)}
              AND ${lt(reviews.reviewedAt, cutoff)}
              AND NOT EXISTS (
                SELECT 1 FROM ${replies}
                WHERE ${replies.reviewId} = ${reviews.id}
                  AND ${replies.organizationId} = ${organizationId}
                  AND ${replies.status} = 'published'
              )
          ), inbox_work AS MATERIALIZED (
            SELECT ${inboxItems.sourceType}::text || ':' ||
              ${inboxItems.sourceId}::text AS work_key,
              ${inboxItems.status} AS status,
              ${inboxItems.isEscalated} AS is_escalated,
              ${inboxItems.escalationResolvedAt} AS escalation_resolved_at
            FROM ${inboxItems}
            WHERE ${inboxScopeWhere(organizationId, propertyId)}
              AND (
                ${inboxItems.status} = 'open'
                OR (
                  ${inboxItems.isEscalated} = true
                  AND ${inboxItems.escalationResolvedAt} IS NULL
                )
              )
          ), goal_work AS MATERIALIZED (
            SELECT 'goal-result:' || ${goalMonthlyResults.id}::text AS work_key
            FROM ${goalMonthlyResults}
            JOIN ${goalPrograms}
              ON ${goalPrograms.organizationId} = ${goalMonthlyResults.organizationId}
              AND ${goalPrograms.propertyId} = ${goalMonthlyResults.propertyId}
              AND ${goalPrograms.id} = ${goalMonthlyResults.programId}
            JOIN ${goalProgramVersions}
              ON ${goalProgramVersions.organizationId} = ${goalMonthlyResults.organizationId}
              AND ${goalProgramVersions.propertyId} = ${goalMonthlyResults.propertyId}
              AND ${goalProgramVersions.programId} = ${goalMonthlyResults.programId}
              AND ${goalProgramVersions.id} = ${goalMonthlyResults.programVersionId}
            WHERE ${goalMonthlyResults.organizationId} = ${organizationId}
              AND ${goalMonthlyResults.propertyId} = ${propertyId}
              AND ${goalPrograms.status} = 'active'
              AND ${goalMonthlyResults.status} = 'open'
              AND ${goalMonthlyResults.periodStart} <= ${now}
              AND ${goalMonthlyResults.periodEnd} > ${now}
              AND ${goalMonthlyResults.evaluationState} = 'eligible'
              AND ${goalProgramVersions.metricKey} IN (
                'qualified_scans',
                'portal_rating_count'
              )
              AND ${goalMonthlyResults.value} < ${goalProgramVersions.targetValue} *
                GREATEST(0, LEAST(1,
                  EXTRACT(EPOCH FROM (${now} - ${goalMonthlyResults.periodStart}))
                  / NULLIF(
                    EXTRACT(EPOCH FROM (
                      ${goalMonthlyResults.periodEnd}
                      - ${goalMonthlyResults.periodStart}
                    )),
                    0
                  )
                ))
          ), attention_work AS MATERIALIZED (
            SELECT work_key FROM unanswered_review_work
            UNION
            SELECT work_key FROM inbox_work
            UNION
            SELECT work_key FROM goal_work
          )
          SELECT
            (SELECT count(*) FROM unanswered_review_work) AS unanswered,
            (SELECT count(*) FROM inbox_work WHERE status = 'open')
              AS items_to_triage,
            (SELECT count(*) FROM inbox_work
              WHERE is_escalated = true AND escalation_resolved_at IS NULL)
              AS escalated,
            (SELECT count(*) FROM goal_work) AS goals_behind_pace,
            (SELECT count(*) FROM attention_work) AS attention_work
        `),
      )
      const row = result.rows[0] as
        | {
            unanswered?: string | number
            items_to_triage?: string | number
            escalated?: string | number
            goals_behind_pace?: string | number
            attention_work?: string | number
          }
        | undefined
      return {
        unanswered: Number(row?.unanswered ?? 0),
        itemsToTriage: Number(row?.items_to_triage ?? 0),
        escalated: Number(row?.escalated ?? 0),
        goalsBehindPace: Number(row?.goals_behind_pace ?? 0),
        attentionWork: Number(row?.attention_work ?? 0),
      }
    })
  },
})
