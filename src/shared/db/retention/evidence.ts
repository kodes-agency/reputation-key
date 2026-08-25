// Retention evidence — content-free deletion evidence rows (BQC-1.6).
// Local IDs, policy version, timestamps, counts, outcome, error code only.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'

/**
 * Retention policy version stamped on every evidence row.
 *   1 (BQC-1.6): initial 9-rule registry + reviews.purge lifecycle purges.
 *   2 (BQC-7.8): + policy_decision_audit / audit_logs at the 365d audit
 *      horizon; + quarantine.ttl sweep subject; retention_runs documented
 *      indefinite-by-design (docs/operations/backup-and-lifecycle.md).
 *   3: + separately counted, seven-day guest abuse-pseudonym redaction.
 *   4: + 90-day terminal notification-digest batch evidence.
 *   5: + class-separated Guest recovery, private-text, and 24-month fact expiry.
 */
const RETENTION_POLICY_VERSION = 5

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
    rowsRedacted?: number
    outcome: 'completed' | 'failed'
    errorCode?: string
  }>,
): Promise<void> {
  await db.execute(sql`
    UPDATE retention_runs SET
      finished_at = ${patch.finishedAt},
      batches = ${patch.batches ?? 0},
      rows_deleted = ${patch.rowsDeleted ?? 0},
      rows_redacted = ${patch.rowsRedacted ?? 0},
      outcome = ${patch.outcome},
      error_code = ${patch.errorCode ?? null},
      policy_version = ${RETENTION_POLICY_VERSION}
    WHERE id = ${id}
  `)
}

/**
 * Close a run as failed, best-effort (BQC-7.8, factored from the purge /
 * sweep call sites): the evidence write must never throw into the caller's
 * error path — the original error is the one that matters.
 */
export async function failRetentionRun(
  db: Database,
  id: string,
  finishedAt: Date,
  err: unknown,
): Promise<void> {
  await closeRetentionRun(db, id, {
    finishedAt,
    outcome: 'failed',
    errorCode: (err instanceof Error ? err.message : String(err)).slice(0, 200),
  }).catch(() => {})
}
