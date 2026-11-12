// The SQL of the platform's work-items rights executor: what one Organization
// holds, what blocks its deletion, and the deletion itself. Every statement is
// bound to one organization_id.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { SETTLED_OUTBOX_EVENTS_WHERE } from '#/shared/outbox/infrastructure/retention.server'
import type { Tx } from '#/shared/outbox/commit'

const UNFINISHED_STATES = ['pending', 'running', 'uncertain', 'quarantined'] as const

export type WorkItemsFootprint = Readonly<{
  items: number
  unfinished: number
  unsettledEvents: number
}>

export async function workItemsFootprintInTx(
  tx: Tx,
  organizationId: string,
): Promise<WorkItemsFootprint> {
  const result = await tx.execute(sql`
    SELECT
      (SELECT count(*)::int FROM work_items
        WHERE organization_id = ${organizationId}) AS items,
      (SELECT count(*)::int FROM work_items
        WHERE organization_id = ${organizationId}
          AND state IN (${sql.join(
            UNFINISHED_STATES.map((state) => sql`${state}`),
            sql`, `,
          )})) AS unfinished,
      (SELECT count(*)::int FROM outbox_events
        WHERE organization_id = ${organizationId}
          AND recovery_fenced_at IS NULL
          AND NOT (${sql.raw(SETTLED_OUTBOX_EVENTS_WHERE)})) AS unsettled_events
  `)
  const row = result.rows[0] as Record<string, number>
  return {
    items: Number(row.items),
    unfinished: Number(row.unfinished),
    unsettledEvents: Number(row.unsettled_events),
  }
}

export function readWorkItemsFootprint(
  db: Database,
  organizationId: string,
): Promise<WorkItemsFootprint> {
  return db.transaction((tx) => workItemsFootprintInTx(tx, organizationId), {
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  })
}

/** Deletes the Organization's work items; returns the rows removed. */
export async function deleteWorkItemsInTx(
  tx: Tx,
  organizationId: string,
): Promise<number> {
  const deleted = await tx.execute(sql`
    DELETE FROM work_items WHERE organization_id = ${organizationId} RETURNING 1
  `)
  return deleted.rows.length
}

/** Deletes behind a refusal check that runs in the same transaction. */
export function deleteWorkItems(
  db: Database,
  organizationId: string,
  refusalOf: (held: WorkItemsFootprint) => string | null,
): Promise<number> {
  return db.transaction(async (tx) => {
    const refusal = refusalOf(await workItemsFootprintInTx(tx, organizationId))
    if (refusal) throw new Error(refusal)
    return deleteWorkItemsInTx(tx, organizationId)
  })
}
