// The SQL of the platform's work-items rights executor: what one Organization
// holds, what blocks its deletion, and the deletion itself. Every statement is
// bound to one organization_id.
//
// A restore fences the outbox events that were unpublished at the restore
// point: they are never delivered, and the outbox retention never removes
// them, so their payloads (which can name users) would outlive the closure.
// The closure deletes them with the work items.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { SETTLED_OUTBOX_EVENTS_WHERE } from '#/shared/outbox/infrastructure/retention.server'
import type { Tx } from '#/shared/outbox/commit'

const UNFINISHED_STATES = ['pending', 'running', 'uncertain', 'quarantined'] as const

const UNFINISHED = sql`state IN (${sql.join(
  UNFINISHED_STATES.map((state) => sql`${state}`),
  sql`, `,
)})`

export type WorkItemsFootprint = Readonly<{
  items: number
  unfinished: number
  unsettledEvents: number
  fencedEvents: number
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
        WHERE organization_id = ${organizationId} AND ${UNFINISHED}) AS unfinished,
      (SELECT count(*)::int FROM outbox_events
        WHERE organization_id = ${organizationId}
          AND recovery_fenced_at IS NULL
          AND NOT (${sql.raw(SETTLED_OUTBOX_EVENTS_WHERE)})) AS unsettled_events,
      (SELECT count(*)::int FROM outbox_events
        WHERE organization_id = ${organizationId}
          AND recovery_fenced_at IS NOT NULL) AS fenced_events
  `)
  const row = result.rows[0] as Record<string, number>
  return {
    items: Number(row.items),
    unfinished: Number(row.unfinished),
    unsettledEvents: Number(row.unsettled_events),
    fencedEvents: Number(row.fenced_events),
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

/**
 * Deletes the Organization's settled work items and its recovery-fenced outbox
 * events (their consumer receipts go by cascade); returns the rows removed.
 */
export async function deleteWorkItemsInTx(
  tx: Tx,
  organizationId: string,
): Promise<number> {
  const items = await tx.execute(sql`
    DELETE FROM work_items
    WHERE organization_id = ${organizationId} AND NOT ${UNFINISHED}
    RETURNING 1
  `)
  const events = await tx.execute(sql`
    DELETE FROM outbox_events
    WHERE organization_id = ${organizationId} AND recovery_fenced_at IS NOT NULL
    RETURNING 1
  `)
  return items.rows.length + events.rows.length
}

/**
 * Deletes behind a refusal check that runs in the same transaction, with the
 * Organization's work items locked so none is reopened between the two.
 */
export function deleteWorkItems(
  db: Database,
  organizationId: string,
  refusalOf: (held: WorkItemsFootprint) => string | null,
): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT 1 FROM work_items WHERE organization_id = ${organizationId} FOR UPDATE
    `)
    const refusal = refusalOf(await workItemsFootprintInTx(tx, organizationId))
    if (refusal) throw new Error(refusal)
    return deleteWorkItemsInTx(tx, organizationId)
  })
}
