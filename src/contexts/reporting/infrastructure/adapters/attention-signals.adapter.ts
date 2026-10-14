// Dashboard context — Drizzle adapter implementing AttentionSignalsPort.
// Count queries for Dashboard-owned property attention reasons.
// Inbox supplies overdue Google response-target counts at the use-case boundary;
// this adapter owns only current Inbox work, escalations, Goal pace, and their
// distinct work-anchor union. Goal pace is the live month to date of the
// Property's running count goals held to `goalsBehindPaceByProperty`; a goal is
// one work anchor, and never an Inbox one, so the union is their sum.

import type { Database } from '#/shared/db'
import { inboxItems } from '#/shared/db/schema'
import { sql } from 'drizzle-orm'
import { trace } from '#/shared/observability/trace'
import type { AttentionSignalsPort } from '../../application/ports/attention-signals.port'
import type { Clock } from '#/shared/domain/clock'
import { goalsBehindPaceByProperty } from '../../domain/goal-pace'
import { readRunningCountMonths } from './goal-running-months'
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
      // One clock read, and both reads in one transaction, keep the overlapping
      // reasons together while preserving the injected-time rule (ADR 0017).
      const now = clock()
      const { result, goalMonths } = await withStatementTimeout(
        db,
        DASHBOARD_READ_BUDGET_MS,
        async (tx) => ({
          result: await tx.execute(sql`
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
            )
            SELECT
              (SELECT count(*) FROM inbox_work WHERE status = 'open')
                AS items_to_triage,
              (SELECT count(*) FROM inbox_work
                WHERE is_escalated = true AND escalation_resolved_at IS NULL)
                AS escalated,
              (SELECT count(*) FROM inbox_work) AS inbox_attention_work
          `),
          goalMonths: await readRunningCountMonths(tx, {
            organizationId,
            properties: sql`results.property_id = ${propertyId}`,
            now,
          }),
        }),
      )
      const row = result.rows[0] as
        | {
            items_to_triage?: string | number
            escalated?: string | number
            inbox_attention_work?: string | number
          }
        | undefined
      const goalsBehindPace =
        goalsBehindPaceByProperty(goalMonths, now).get(propertyId) ?? 0
      return {
        // The use-case boundary replaces this neutral value from Inbox's target read.
        overdue: 0,
        itemsToTriage: Number(row?.items_to_triage ?? 0),
        escalated: Number(row?.escalated ?? 0),
        goalsBehindPace,
        attentionWork: Number(row?.inbox_attention_work ?? 0) + goalsBehindPace,
      }
    })
  },
})
