import { sql } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'

/** Reconnect records the request with its connection change and durable fact. */
export async function requestGooglePrimaryCategoryRefresh(
  tx: Tx,
  input: Readonly<{ organizationId: string; connectionId: string; eventId: string }>,
): Promise<void> {
  await tx.execute(sql`
    UPDATE properties
    SET google_primary_category_refresh_event_id = ${input.eventId}::uuid
    WHERE organization_id = ${input.organizationId}
      AND google_connection_id = ${input.connectionId}::uuid
      AND google_binding_state = 'active'
      AND deleted_at IS NULL
  `)
}
