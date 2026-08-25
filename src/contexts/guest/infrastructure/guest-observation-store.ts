import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { scanEvents } from '#/shared/db/schema/guest.schema'
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

    commitReviewLinkClick: (fact) =>
      trace('guest.observationStore.commitReviewLinkClick', async () => {
        await db.transaction((tx) => insertOutboxRow(tx, fact))
        await emitAfterCommit(events, fact)
        return 'applied' as const
      }),
  }
}
