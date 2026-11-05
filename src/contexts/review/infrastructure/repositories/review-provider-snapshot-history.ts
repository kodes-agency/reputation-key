import { sql } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { reviewSyncRuns } from '#/shared/db/schema/review-sync.schema'
import type { reviewProviderSnapshotRuns } from '#/shared/db/schema/review.schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import {
  googleProviderFailure,
  type GoogleProviderFailure,
} from '#/shared/domain/google-provider-failure'
import type { ReviewProviderSnapshotFailureCode } from '../../application/ports/review-provider-snapshot.repository'
import { historyImportFailureReason } from '../../application/historical-import-outcome'
import { reviewPropertyHistoryImportFinished } from '../../domain/events'

type RunRow = typeof reviewProviderSnapshotRuns.$inferSelect

/**
 * Write the import's own terminal fact, in the transaction that makes the run
 * terminal. Counts and identifiers only: what the run had listed, and the
 * closed reason a failure leaves a reader to act on.
 */
export async function recordHistoryImportFinished(
  tx: Tx,
  run: RunRow,
  settlement:
    | Readonly<{ outcome: 'completed' }>
    | Readonly<{ outcome: 'failed'; code: ReviewProviderSnapshotFailureCode }>,
): Promise<void> {
  const rows = await tx.execute(sql`SELECT transaction_timestamp() AS finished_at`)
  const value = (rows.rows[0] as { finished_at: Date | string }).finished_at
  const finishedAt = value instanceof Date ? value : new Date(value)
  const finished = reviewPropertyHistoryImportFinished({
    organizationId: organizationId(run.organizationId),
    propertyId: propertyId(run.propertyId),
    sourceEpoch: run.sourceEpoch,
    runId: run.id,
    outcome: settlement.outcome,
    reviewsObserved: run.mainUniqueCount,
    failureReason:
      settlement.outcome === 'failed'
        ? historyImportFailureReason(settlement.code)
        : null,
    occurredAt: finishedAt,
  })
  await insertOutboxRow(tx, finished, { recordedAt: finishedAt })
}

/** The diagnostic history uses the failed snapshot's id and transaction. */
export async function recordProviderFailure(
  tx: Tx,
  run: Pick<
    RunRow,
    | 'id'
    | 'propertyId'
    | 'sourceEpoch'
    | 'startedAt'
    | 'terminalAt'
    | 'mainPageCount'
    | 'confirmationPageCount'
    | 'mainUniqueCount'
  >,
  code: ReviewProviderSnapshotFailureCode,
  providerFailure: GoogleProviderFailure,
): Promise<void> {
  await tx.insert(reviewSyncRuns).values({
    id: run.id,
    propertyId: run.propertyId,
    source: 'google',
    mode: 'snapshot',
    sourceEpoch: run.sourceEpoch,
    startedAt: run.startedAt,
    completedAt: run.terminalAt,
    pageCount: run.mainPageCount + run.confirmationPageCount,
    reviewCount: run.mainUniqueCount,
    failedCount: 1,
    errorClass: code,
    result: JSON.stringify(googleProviderFailure(providerFailure)),
  })
}
