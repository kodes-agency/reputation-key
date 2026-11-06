import { and, asc, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Tx } from '#/shared/outbox/commit'
import { gbpImportRequestItems } from '#/shared/db/schema/google-import-v2.schema'
import type { GoogleImportV2Store } from '../application/ports/google-import-v2-store.port'

const RECOVERY_APPOINTMENT_MS = 60_000

async function advanceAppointment(
  tx: Tx,
  organizationId: string,
  itemId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(gbpImportRequestItems)
    .set({
      nextDispatchAt: new Date(now.getTime() + RECOVERY_APPOINTMENT_MS),
    })
    .where(
      and(
        eq(gbpImportRequestItems.organizationId, organizationId),
        eq(gbpImportRequestItems.id, itemId),
      ),
    )
}

export const createGoogleImportDueReservation =
  (db: Database): GoogleImportV2Store['reserveDueItems'] =>
  async (now, limit) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('google import recovery limit must be between 1 and 100')
    }
    return db.transaction(async (tx) => {
      const rows = await tx
        .select({
          organizationId: gbpImportRequestItems.organizationId,
          importJobId: gbpImportRequestItems.importJobId,
          itemId: gbpImportRequestItems.id,
          status: gbpImportRequestItems.status,
          retryRevision: gbpImportRequestItems.retryRevision,
          dispatchEpoch: gbpImportRequestItems.dispatchEpoch,
          claimFence: gbpImportRequestItems.claimFence,
          attemptOrdinal: gbpImportRequestItems.highestAttemptForRevision,
          effectDeadlineAt: gbpImportRequestItems.effectDeadlineAt,
          expectedConnectionLifecycleVersion:
            gbpImportRequestItems.expectedConnectionLifecycleVersion,
          expectedSourceEpoch: gbpImportRequestItems.expectedSourceEpoch,
        })
        .from(gbpImportRequestItems)
        .where(
          and(
            sql`${gbpImportRequestItems.status} IN ('pending', 'processing')`,
            sql`(${gbpImportRequestItems.nextDispatchAt} <= ${now} OR ${gbpImportRequestItems.nextDispatchAt} IS NULL)`,
            sql`(${gbpImportRequestItems.status} = 'pending' OR ${gbpImportRequestItems.claimLeaseExpiresAt} <= ${now})`,
          ),
        )
        .orderBy(
          sql`${gbpImportRequestItems.nextDispatchAt} ASC NULLS FIRST`,
          asc(gbpImportRequestItems.id),
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
