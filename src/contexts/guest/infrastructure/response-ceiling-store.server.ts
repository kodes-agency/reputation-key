import { createHash, createHmac } from 'node:crypto'
import { and, count, eq, gte, lt, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { guestNetworkPressureRecords } from '#/shared/db/schema/guest.schema'
import type { GuestResponseScope } from '../application/ports/guest-response.repository'
import { GUEST_NETWORK_PRESSURE_RETENTION_MS } from '../domain/networkPressure'
import {
  responseWindowStart,
  type ResponseAdmission,
  type ResponseCeilingStore,
  type ResponseCeilingTransaction,
} from '../application/use-cases/response-ceiling.server'

// Shared counters have no network identity. These markers are distinct from
// the keyed, per-network pseudonyms that the earlier admission layer consumes.
export const RESPONSE_PRESSURE_MARKERS = {
  admitted: createHash('sha256').update('guest-response-ceiling:admitted').digest('hex'),
  dropped: createHash('sha256').update('guest-response-ceiling:dropped').digest('hex'),
  alert: createHash('sha256').update('guest-response-ceiling:alert').digest('hex'),
} as const

type QueryDb = Pick<Database, 'select' | 'insert'>

export function createResponseCeilingStore(
  db: Database,
  secret: string,
): ResponseCeilingStore {
  const recordId = (parts: readonly unknown[]) => {
    const digest = createHmac('sha256', secret)
      .update(JSON.stringify(parts))
      .digest('hex')
    return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`
  }
  const sessionKey = (scope: GuestResponseScope, sessionId: string) =>
    recordId([
      'guest-response-reservation',
      scope.organizationId,
      scope.propertyId,
      scope.portalId,
      sessionId,
    ])
  const pressureRow = (
    scope: GuestResponseScope,
    id: string,
    pseudonym: string,
    observedAt: Date,
  ) => ({
    id,
    ...scope,
    pseudonym,
    action: 'rating',
    observedAt,
    expiresAt: new Date(observedAt.getTime() + GUEST_NETWORK_PRESSURE_RETENTION_MS),
  })
  const queries = (connection: QueryDb): ResponseCeilingTransaction => ({
    find: async (scope, sessionId) => {
      const [row] = await connection
        .select()
        .from(guestNetworkPressureRecords)
        .where(
          and(
            eq(guestNetworkPressureRecords.id, sessionKey(scope, sessionId)),
            eq(guestNetworkPressureRecords.organizationId, scope.organizationId),
            eq(guestNetworkPressureRecords.propertyId, scope.propertyId),
            eq(guestNetworkPressureRecords.portalId, scope.portalId),
          ),
        )
        .limit(1)
      if (!row) return null
      if (
        row.action !== 'rating' ||
        ![RESPONSE_PRESSURE_MARKERS.admitted, RESPONSE_PRESSURE_MARKERS.dropped].includes(
          row.pseudonym,
        )
      ) {
        throw new Error('Invalid guest response admission record')
      }
      return {
        allowed: row.pseudonym === RESPONSE_PRESSURE_MARKERS.admitted,
        recordedAt: row.observedAt,
        expiresAt: new Date(row.observedAt.getTime() + 24 * 60 * 60 * 1000),
      }
    },
    counts: async (scope, now) => {
      const day = responseWindowStart(now, 'portalDay')
      const hour = responseWindowStart(now, 'portalHour')
      const end = new Date(day.getTime() + 24 * 60 * 60 * 1000)
      const samePortal = eq(guestNetworkPressureRecords.portalId, scope.portalId)
      const [row] = await connection
        .select({
          organizationDay: count(),
          portalDay: sql<number>`count(*) FILTER (WHERE ${samePortal})::integer`,
          portalHour: sql<number>`count(*) FILTER (WHERE ${samePortal} AND ${guestNetworkPressureRecords.observedAt} >= ${hour})::integer`,
        })
        .from(guestNetworkPressureRecords)
        .where(
          and(
            eq(guestNetworkPressureRecords.organizationId, scope.organizationId),
            eq(guestNetworkPressureRecords.action, 'rating'),
            eq(guestNetworkPressureRecords.pseudonym, RESPONSE_PRESSURE_MARKERS.admitted),
            gte(guestNetworkPressureRecords.observedAt, day),
            lt(guestNetworkPressureRecords.observedAt, end),
          ),
        )
      if (!row) throw new Error('Guest response counts unavailable')
      return row
    },
    record: async (scope, sessionId, admission: ResponseAdmission) => {
      await connection
        .insert(guestNetworkPressureRecords)
        .values(
          pressureRow(
            scope,
            sessionKey(scope, sessionId),
            admission.allowed
              ? RESPONSE_PRESSURE_MARKERS.admitted
              : RESPONSE_PRESSURE_MARKERS.dropped,
            admission.recordedAt,
          ),
        )
    },
    claimAlert: async (scope, window, start) => {
      const id = recordId([
        'guest-response-exhaustion',
        scope.organizationId,
        window === 'organizationDay' ? null : scope.portalId,
        window,
        start.toISOString(),
      ])
      const [row] = await connection
        .insert(guestNetworkPressureRecords)
        .values(pressureRow(scope, id, RESPONSE_PRESSURE_MARKERS.alert, start))
        .onConflictDoNothing()
        .returning({ id: guestNetworkPressureRecords.id })
      return row !== undefined
    },
  })
  return {
    find: queries(db).find,
    withinOrganization: (organizationId, run) =>
      db.transaction(async (tx) => {
        const anchor = `guest-response-ceiling:${organizationId}`
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${anchor}, 0))`,
        )
        return run(queries(tx))
      }),
  }
}
