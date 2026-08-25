import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  guestDestinationActionReceipts,
  scanEvents,
} from '#/shared/db/schema/guest.schema'
import type { EventBus } from '#/shared/events/event-bus'
import { emitAfterCommit, insertOutboxRow } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import type { GuestObservationStore } from '../application/ports/guest-observation-store.port'
import { scanEventToRow } from './mappers/guest.mapper'

export function createAtomicGuestObservationStore(
  db: Database,
  events: EventBus,
): GuestObservationStore {
  return {
    commitScan: (scan, fact) =>
      trace('guest.observationStore.commitScan', async () => {
        if (scan.sessionId === null || scan.ipHash === null) {
          throw new Error('new guest observations require live pseudonyms')
        }
        const sessionId = scan.sessionId
        const outcome = await db.transaction(async (tx) => {
          // The legacy table has no session uniqueness constraint. Serialize
          // this logical anchor without deleting/guessing historical duplicate
          // rows; a later audited migration can add the physical constraint.
          const anchor = `${scan.organizationId}:${scan.portalId}:${sessionId}`
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${anchor}, 0))`,
          )
          const existing = await tx
            .select({ id: scanEvents.id })
            .from(scanEvents)
            .where(
              and(
                eq(scanEvents.organizationId, scan.organizationId),
                eq(scanEvents.portalId, scan.portalId),
                eq(scanEvents.sessionId, sessionId),
              ),
            )
            .limit(1)
          if (existing.length > 0) return 'duplicate' as const
          await tx.insert(scanEvents).values(scanEventToRow(scan))
          await insertOutboxRow(tx, fact)
          return 'applied' as const
        })
        if (outcome === 'applied') await emitAfterCommit(events, fact)
        return outcome
      }),

    commitReviewLinkClick: (action, fact) =>
      trace('guest.observationStore.commitReviewLinkClick', async () => {
        if (
          action.sessionId.trim().length === 0 ||
          action.expiresAt.getTime() <= action.occurredAt.getTime()
        ) {
          throw new Error('qualified destination action requires a live session')
        }
        if (
          action.organizationId !== fact.organizationId ||
          action.propertyId !== fact.propertyId ||
          action.portalId !== fact.portalId ||
          action.destinationId !== fact.linkId ||
          action.destinationKind !== fact.destinationKind ||
          action.occurredAt.getTime() !== fact.occurredAt.getTime()
        ) {
          throw new Error('qualified destination action does not match its fact')
        }
        const outcome = await db.transaction(async (tx) => {
          const inserted = await tx
            .insert(guestDestinationActionReceipts)
            .values({
              organizationId: action.organizationId,
              propertyId: action.propertyId,
              portalId: action.portalId,
              sessionId: action.sessionId,
              destinationId: action.destinationId,
              destinationKind: action.destinationKind,
              expiresAt: action.expiresAt,
              createdAt: action.occurredAt,
            })
            .onConflictDoNothing({
              target: [
                guestDestinationActionReceipts.organizationId,
                guestDestinationActionReceipts.portalId,
                guestDestinationActionReceipts.sessionId,
                guestDestinationActionReceipts.destinationKind,
                guestDestinationActionReceipts.destinationId,
              ],
            })
            .returning({ id: guestDestinationActionReceipts.id })
          if (inserted.length === 0) return 'duplicate' as const
          await insertOutboxRow(tx, fact, { recordedAt: action.occurredAt })
          return 'applied' as const
        })
        if (outcome === 'applied') await emitAfterCommit(events, fact)
        return outcome
      }),
  }
}
