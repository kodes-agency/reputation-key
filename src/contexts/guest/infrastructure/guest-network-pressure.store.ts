import { and, count, eq, gt, min, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { guestNetworkPressureRecords } from '#/shared/db/schema/guest.schema'
import type { GuestNetworkPressureStore } from '../application/ports/guest-network-pressure.store.port'
import {
  GUEST_NETWORK_PRESSURE_RETENTION_MS,
  createGuestNetworkPressureRecord,
} from '../domain/networkPressure'
import { trace } from '#/shared/observability/trace'

export const createGuestNetworkPressureStore = (
  db: Database,
  idGen: () => string,
): GuestNetworkPressureStore => {
  return {
    consume: (input) =>
      trace('guest.networkPressure.consume', async () => {
        if (!Number.isInteger(input.maxRequests) || input.maxRequests < 1) {
          throw new Error('Guest network pressure maximum must be a positive integer')
        }
        if (
          !Number.isInteger(input.windowSeconds) ||
          input.windowSeconds < 1 ||
          input.windowSeconds * 1000 > GUEST_NETWORK_PRESSURE_RETENTION_MS
        ) {
          throw new Error('Guest network pressure window must fit the retention period')
        }

        const windowMs = input.windowSeconds * 1000
        const cutoff = new Date(input.observedAt.getTime() - windowMs)
        return db.transaction(async (tx) => {
          const anchor = [
            'guest-network-pressure-v1',
            input.organizationId,
            input.propertyId,
            input.portalId,
            input.pseudonym,
            input.action,
          ].join(':')
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${anchor}, 0))`,
          )

          const [pressure] = await tx
            .select({
              total: count(),
              oldestObservedAt: min(guestNetworkPressureRecords.observedAt),
            })
            .from(guestNetworkPressureRecords)
            .where(
              and(
                eq(guestNetworkPressureRecords.organizationId, input.organizationId),
                eq(guestNetworkPressureRecords.propertyId, input.propertyId),
                eq(guestNetworkPressureRecords.portalId, input.portalId),
                eq(guestNetworkPressureRecords.pseudonym, input.pseudonym),
                eq(guestNetworkPressureRecords.action, input.action),
                gt(guestNetworkPressureRecords.observedAt, cutoff),
                gt(guestNetworkPressureRecords.expiresAt, input.observedAt),
              ),
            )
          const total = pressure?.total ?? 0
          const oldestObservedAt = pressure?.oldestObservedAt ?? input.observedAt
          const resetAt = new Date(oldestObservedAt.getTime() + windowMs)

          if (total >= input.maxRequests) {
            return { allowed: false, remaining: 0, resetAt }
          }

          const record = createGuestNetworkPressureRecord({
            id: idGen(),
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            portalId: input.portalId,
            pseudonym: input.pseudonym,
            action: input.action,
            observedAt: input.observedAt,
          })
          if (record.isErr()) throw record.error
          await tx.insert(guestNetworkPressureRecords).values(record.value)
          return {
            allowed: true,
            remaining: input.maxRequests - total - 1,
            resetAt,
          }
        })
      }),
  }
}
