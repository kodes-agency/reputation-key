import { and, asc, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Tx } from '#/shared/outbox/commit'
import { googleImportItems } from '#/shared/db/schema/google-import.schema'
import type { GoogleImportV2Store } from '../application/ports/google-import-v2-store.port'

const RECOVERY_APPOINTMENT_MS = 60_000

async function advanceAppointment(
  tx: Tx,
  organizationId: string,
  itemId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(googleImportItems)
    .set({
      nextDispatchAt: new Date(now.getTime() + RECOVERY_APPOINTMENT_MS),
    })
    .where(
      and(
        eq(googleImportItems.organizationId, organizationId),
        eq(googleImportItems.id, itemId),
      ),
    )
}

export const createImportDueReservation =
  (db: Database): GoogleImportV2Store['reserveDueItems'] =>
  async (now, limit) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('google import recovery limit must be between 1 and 100')
    }
    return db.transaction(async (tx) => {
      const rows = await tx
        .select({
          organizationId: googleImportItems.organizationId,
          importJobId: googleImportItems.importId,
          itemId: googleImportItems.id,
          status: googleImportItems.status,
          retryRevision: googleImportItems.retryRevision,
          dispatchEpoch: googleImportItems.dispatchEpoch,
          claimFence: googleImportItems.claimFence,
          attemptOrdinal: googleImportItems.highestAttemptForRevision,
          effectDeadlineAt: googleImportItems.effectDeadlineAt,
          expectedConnectionLifecycleVersion:
            googleImportItems.expectedConnectionLifecycleVersion,
          expectedSourceEpoch: googleImportItems.expectedSourceEpoch,
        })
        .from(googleImportItems)
        .where(
          and(
            sql`${googleImportItems.status} IN ('pending', 'processing')`,
            sql`${googleImportItems.nextDispatchAt} <= ${now}`,
            sql`(${googleImportItems.status} = 'pending' OR ${googleImportItems.claimLeaseExpiresAt} <= ${now})`,
          ),
        )
        .orderBy(
          sql`${googleImportItems.nextDispatchAt} ASC NULLS FIRST`,
          asc(googleImportItems.id),
        )
        .limit(limit)
        .for('update', { skipLocked: true })

      // Commit the next appointment before receipt reads, queue calls or effects.
      // Even a corrupt row or a failed enqueue rotates behind untouched due work.
      for (const row of rows) {
        await advanceAppointment(tx, row.organizationId, row.itemId, now)
      }
      return rows.flatMap((row) =>
        (row.status === 'pending' || row.status === 'processing') &&
        row.expectedConnectionLifecycleVersion !== null
          ? [
              {
                ...row,
                status: row.status,
                expectedConnectionLifecycleVersion:
                  row.expectedConnectionLifecycleVersion,
              },
            ]
          : [],
      )
    })
  }
