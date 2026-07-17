// Retention evidence — content-free deletion evidence rows (BQC-1.6).
// Local IDs, policy version, timestamps, counts, outcome, error code only.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'

export const RETENTION_POLICY_VERSION = 1

export async function openRetentionRun(
  db: Database,
  subject: string,
  batchSize: number,
  startedAt: Date,
): Promise<string> {
  const rows = await db.execute(sql`
    INSERT INTO retention_runs (subject, started_at, batch_size, outcome, policy_version)
    VALUES (${subject}, ${startedAt}, ${batchSize}, 'completed', ${RETENTION_POLICY_VERSION})
    RETURNING id
  `)
  return (rows.rows[0] as { id: string }).id
}

export async function closeRetentionRun(
  db: Database,
  id: string,
  patch: Readonly<{
    finishedAt: Date
    batches?: number
    rowsDeleted?: number
    outcome: 'completed' | 'failed'
    errorCode?: string
  }>,
): Promise<void> {
  await db.execute(sql`
    UPDATE retention_runs SET
      finished_at = ${patch.finishedAt},
      batches = ${patch.batches ?? 0},
      rows_deleted = ${patch.rowsDeleted ?? 0},
      outcome = ${patch.outcome},
      error_code = ${patch.errorCode ?? null},
      policy_version = ${RETENTION_POLICY_VERSION}
    WHERE id = ${id}
  `)
}
