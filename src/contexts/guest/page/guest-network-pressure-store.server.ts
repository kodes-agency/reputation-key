import { and, count, eq, gt, min, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { guestNetworkPressureRecords } from '#/shared/db/schema/guest.schema'
import {
  type GuestNetworkPressureAction,
  GUEST_NETWORK_PRESSURE_RETENTION_MS,
  createGuestNetworkPressureRecord,
} from '../domain/networkPressure'
import { trace } from '#/shared/observability/trace'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'

export type GuestNetworkPressureConsumeInput = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  pseudonym: string
  action: GuestNetworkPressureAction
  maxRequests: number
  windowSeconds: number
}>

export type GuestNetworkPressureDecision = Readonly<{
  allowed: boolean
  remaining: number
  resetAt: Date
}>

export type GuestNetworkPressureStore = Readonly<{
  consume(input: GuestNetworkPressureConsumeInput): Promise<GuestNetworkPressureDecision>
}>

export const createGuestNetworkPressureStore = (
  db: Database,
  clock: () => Date,
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

        const observedAt = clock()
        const windowMs = input.windowSeconds * 1000
        const cutoff = new Date(observedAt.getTime() - windowMs)
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
                gt(guestNetworkPressureRecords.expiresAt, observedAt),
              ),
            )
          const total = pressure?.total ?? 0
          const oldestObservedAt = pressure?.oldestObservedAt ?? observedAt
          const resetAt = new Date(oldestObservedAt.getTime() + windowMs)

          if (total >= input.maxRequests) {
            return { allowed: false, remaining: 0, resetAt }
          }

          const record = createGuestNetworkPressureRecord({
            id: idGen(),
            organizationId: organizationId(input.organizationId),
            propertyId: propertyId(input.propertyId),
            portalId: portalId(input.portalId),
            pseudonym: input.pseudonym,
            action: input.action,
            observedAt,
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
