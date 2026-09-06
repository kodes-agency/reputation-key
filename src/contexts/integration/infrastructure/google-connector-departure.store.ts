import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { googleConnections } from '#/shared/db/schema/google-connection.schema'
import { googleConnectionId } from '#/shared/domain/ids'
import { insertOutboxRow } from '#/shared/outbox/commit'
import type { GoogleConnectorDepartureStore } from '../application/ports/google-connector-departure.port'
import { integrationGoogleAccountReauthorizationRequired } from '../domain/events'

type LockedConnection = Readonly<{
  id: string
  status: string
}>

/**
 * PostgreSQL implementation of the connector-departure fence. Rows are locked
 * in UUID order so concurrent membership/offboarding paths cannot invert lock
 * acquisition. State and one identifier-only fact per transition commit in the
 * same transaction; already-fenced rows are returned for cancellation retry.
 */
export const createGoogleConnectorDepartureStore = (
  db: Database,
): GoogleConnectorDepartureStore => ({
  fenceForDeparture: async (input) => {
    return db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT id, status
        FROM google_connections
        WHERE organization_id = ${input.organizationId}
          AND COALESCE(credential_authorized_by, connected_by) = ${input.connectorUserId}
          AND credential_use_state = 'active'
          AND status NOT IN ('disconnecting', 'disconnected')
        ORDER BY id
        FOR UPDATE
      `)
      const rows = locked.rows as LockedConnection[]
      const connectionIds = rows.map((row) => googleConnectionId(row.id))
      const transitionedConnectionIds = rows
        .filter((row) => row.status !== 'reauth_required')
        .map((row) => googleConnectionId(row.id))

      if (transitionedConnectionIds.length > 0) {
        await tx
          .update(googleConnections)
          .set({
            status: 'reauth_required',
            lifecycleVersion: sql`${googleConnections.lifecycleVersion} + 1`,
            accessVersion: sql`${googleConnections.accessVersion} + 1`,
            statusReason: `connector_departure_${input.cause}`,
            statusChangedAt: input.occurredAt,
            updatedAt: input.occurredAt,
          })
          .where(
            and(
              eq(googleConnections.organizationId, input.organizationId),
              inArray(googleConnections.id, [...transitionedConnectionIds]),
            ),
          )

        for (const connectionId of transitionedConnectionIds) {
          const event = integrationGoogleAccountReauthorizationRequired({
            connectionId,
            organizationId: input.organizationId,
            cause: input.cause,
            occurredAt: input.occurredAt,
          })
          await insertOutboxRow(tx, event, { recordedAt: input.occurredAt })
        }
      }

      return { connectionIds, transitionedConnectionIds }
    })
  },
})
