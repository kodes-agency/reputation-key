// BQC-1.2 — bounded null-backfill of inbox raw source copies.
//
// Migrates legacy denormalized copies (snippet / reviewer_name / rating) to
// NULL in bounded batches. Predicate-driven: idempotent and resumable by
// construction — re-running simply finds no remaining copies. Runs AFTER
// reads already resolve via the eligibility-enforcing review lookup
// (cutover order BQC-1 §7: eligible reads first, cleanup second).

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'

export type NullBackfillResult = Readonly<{
  batches: number
  rowsNulled: number
}>

export async function nullInboxSourceCopies(
  db: Database,
  options: {
    batchSize?: number
    onBatch?: (batch: number, rows: number) => void
  } = {},
): Promise<NullBackfillResult> {
  const batchSize = options.batchSize ?? 500
  let batches = 0
  let rowsNulled = 0

  for (;;) {
    // One bounded UPDATE per batch (atomic per batch). updated_at is
    // deliberately untouched — this correction must not perturb UI ordering
    // or any recently-updated consumers.
    const result = await db.execute(sql`
      UPDATE inbox_items
      SET snippet = NULL, reviewer_name = NULL, rating = NULL
      WHERE id IN (
        SELECT id FROM inbox_items
        WHERE snippet IS NOT NULL OR reviewer_name IS NOT NULL OR rating IS NOT NULL
        LIMIT ${batchSize}
      )
      RETURNING id
    `)
    const count = result.rowCount ?? 0
    if (count === 0) break
    batches += 1
    rowsNulled += count
    options.onBatch?.(batches, count)
  }

  return { batches, rowsNulled }
}
