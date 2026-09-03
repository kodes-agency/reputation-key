// Dashboard context — Drizzle adapter implementing AttentionSignalsPort.
// Count queries for Dashboard-owned property attention reasons.
// Inbox supplies overdue Google response-target counts at the use-case boundary;
// this adapter owns only current Inbox work, escalations, Goal pace, and their
// distinct work-anchor union.

import type { Database } from '#/shared/db'
import {
  goalMonthlyResults,
  goalPrograms,
  goalProgramVersions,
  inboxItems,
} from '#/shared/db/schema'
import { sql } from 'drizzle-orm'
import { trace } from '#/shared/observability/trace'
import type { AttentionSignalsPort } from '../../application/ports/attention-signals.port'
import type { Clock } from '#/shared/domain/clock'
import {
  DASHBOARD_READ_BUDGET_MS,
  inboxScopeWhere,
  withStatementTimeout,
} from '../read-facade'

export const createAttentionSignalsAdapter = (
  db: Database,
  clock: Clock,
): AttentionSignalsPort => ({
  async getAttentionCounts(organizationId, propertyId) {
    return trace('dashboard.attention.counts', async () => {
      // One clock read and one statement keep all overlapping reasons on the
      // same snapshot while preserving the injected-time rule (ADR 0017).
      const now = clock()
      const result = await withStatementTimeout(db, DASHBOARD_READ_BUDGET_MS, (tx) =>
        tx.execute(sql`
          WITH inbox_work AS MATERIALIZED (
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
            SELECT work_key FROM inbox_work
            UNION
            SELECT work_key FROM goal_work
          )
          SELECT
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
            items_to_triage?: string | number
            escalated?: string | number
            goals_behind_pace?: string | number
            attention_work?: string | number
          }
        | undefined
      return {
        // The use-case boundary replaces this neutral value from Inbox's target read.
        overdue: 0,
        itemsToTriage: Number(row?.items_to_triage ?? 0),
        escalated: Number(row?.escalated ?? 0),
        goalsBehindPace: Number(row?.goals_behind_pace ?? 0),
        attentionWork: Number(row?.attention_work ?? 0),
      }
    })
  },
})
