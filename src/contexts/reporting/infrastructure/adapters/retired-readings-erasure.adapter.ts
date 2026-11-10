// The database side of the retired-readings erasure command: counts, batch
// selection and the delete of the `property.review` readings, with the
// corrections that point at them. The selection filters on the metric key in
// every statement, so no other key's reading can be named or deleted.

import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type {
  BackupErasureLedgerEntry,
  BackupErasureReplayer,
} from '#/shared/db/lifecycle/backup-erasure-ledger'
import type { Tx } from '#/shared/outbox/commit'
import {
  RETIRED_READINGS_METRIC_KEY,
  type RetiredReadingsStore,
} from '#/shared/ops/retired-readings-erasure-command'

/** A supersession chain is deleted head first, one link per pass. */
const MAX_CHAIN_PASSES = 64

const idList = (ids: ReadonlyArray<string>): SQL =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )

async function eraseBatch(
  tx: Tx,
  organizationId: string,
  readingIds: ReadonlyArray<string>,
): Promise<Readonly<{ readings: number; corrections: number }>> {
  if (readingIds.length === 0) return { readings: 0, corrections: 0 }
  let corrections = 0
  let drained = false
  for (let pass = 0; pass < MAX_CHAIN_PASSES && !drained; pass += 1) {
    const deleted = await tx.execute(sql`
      DELETE FROM metric_corrections AS correction
      WHERE correction.reading_id IN (
        SELECT id FROM metric_readings
        WHERE id IN (${idList(readingIds)})
          AND organization_id = ${organizationId}
          AND metric_key = ${RETIRED_READINGS_METRIC_KEY}
      )
      AND NOT EXISTS (
        SELECT 1 FROM metric_corrections AS successor
        WHERE successor.supersedes_correction_id = correction.id
      )`)
    drained = (deleted.rowCount ?? 0) === 0
    corrections += deleted.rowCount ?? 0
  }
  if (!drained) throw new Error('a supersession chain did not drain')
  const readings = await tx.execute(sql`
    DELETE FROM metric_readings
    WHERE id IN (${idList(readingIds)})
      AND organization_id = ${organizationId}
      AND metric_key = ${RETIRED_READINGS_METRIC_KEY}`)
  return { readings: readings.rowCount ?? 0, corrections }
}

export function createRetiredReadingsStore(db: Database): RetiredReadingsStore {
  return {
    async count(organizationId) {
      const scope = organizationId
        ? sql`AND reading.organization_id = ${organizationId}`
        : sql``
      const result = await db.execute(sql`
        SELECT reading.organization_id AS "organizationId",
               count(DISTINCT reading.id)::int AS readings,
               count(correction.id)::int AS corrections
        FROM metric_readings AS reading
        LEFT JOIN metric_corrections AS correction ON correction.reading_id = reading.id
        WHERE reading.metric_key = ${RETIRED_READINGS_METRIC_KEY} ${scope}
        GROUP BY reading.organization_id
        ORDER BY reading.organization_id`)
      return result.rows as Array<{
        organizationId: string
        readings: number
        corrections: number
      }>
    },
    async nextBatch(organizationId, limit) {
      const result = await db.execute(sql`
        SELECT id FROM metric_readings
        WHERE organization_id = ${organizationId}
          AND metric_key = ${RETIRED_READINGS_METRIC_KEY}
        ORDER BY id
        LIMIT ${limit}`)
      return (result.rows as Array<{ id: string }>).map((row) => row.id)
    },
    erase: (organizationId, readingIds) =>
      db.transaction((tx) => eraseBatch(tx, organizationId, readingIds)),
  }
}

/** Re-erase a journaled batch in a restored cell; a reading already gone is not counted. */
export function createRetiredReadingsReplayer(): BackupErasureReplayer {
  return {
    context: 'metric',
    subjectClass: 'organization',
    targetKind: 'purge_batch',
    async reErase(tx: Tx, entry: BackupErasureLedgerEntry) {
      if (entry.journalTargets?.kind !== 'purge_batch') {
        throw new Error('Retired readings replayer requires a journaled batch')
      }
      const erased = await eraseBatch(tx, entry.organizationId, entry.journalTargets.ids)
      return erased.readings + erased.corrections
    },
  }
}
