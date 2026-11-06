import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { RecoveryFenceCounts } from '#/shared/db/schema/recovery.schema'
import { reapStaleAiReservations } from '../ai/ai-budget'
import {
  validateRecoveryFenceInput,
  type RecoveryFenceInput,
  type RecoveryFenceInventory,
  type RecoveryFenceResult,
} from '#/shared/ops/recovery-fence'

const ZERO_COUNTS: RecoveryFenceCounts = Object.freeze({
  sessionsInvalidated: 0,
  verificationTokensInvalidated: 0,
  invitationsCanceled: 0,
  outboxEventsFenced: 0,
  emailsCanceled: 0,
  digestBatchesTerminated: 0,
  repliesCanceled: 0,
  repliesMadeAmbiguous: 0,
  googleConnectionsFenced: 0,
  googleExecutionPermitsFenced: 0,
  googleSourceOperationsFenced: 0,
  googleRevokePermitsFenced: 0,
  googleImportV2ParentsFenced: 0,
  googleImportV2ItemsFenced: 0,
  aiIssuedPermitsReleased: 0,
  aiConsumedPermitsMadeAmbiguous: 0,
  aiOperationsFenced: 0,
  aiBackfillRunsStalled: 0,
})

type CountRow = Readonly<Partial<Record<keyof RecoveryFenceCounts, number | string>>>

function countsFromRow(row: CountRow | undefined): RecoveryFenceCounts {
  if (!row) throw new Error('recovery fence inventory returned no row')
  return Object.fromEntries(
    Object.keys(ZERO_COUNTS).map((key) => {
      const value = Number(row[key as keyof RecoveryFenceCounts] ?? 0)
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`recovery fence count ${key} is invalid`)
      }
      return [key, value]
    }),
  ) as RecoveryFenceCounts
}

function addCounts(
  accumulated: RecoveryFenceCounts,
  delta: RecoveryFenceCounts,
): RecoveryFenceCounts {
  return Object.fromEntries(
    Object.keys(ZERO_COUNTS).map((key) => {
      const countKey = key as keyof RecoveryFenceCounts
      return [key, accumulated[countKey] + delta[countKey]]
    }),
  ) as RecoveryFenceCounts
}

/**
 * Content-free inventory of authority/effect states that an older database can
 * resurrect. The counts are both the dry-run report and the before-image for
 * the immutable recovery run.
 */
export async function inspectRecoveryFence(
  db: Database,
): Promise<RecoveryFenceInventory> {
  const result = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM session) AS "sessionsInvalidated",
      (SELECT count(*)::int FROM verification) AS "verificationTokensInvalidated",
      (SELECT count(*)::int FROM invitation WHERE status = 'pending') AS "invitationsCanceled",
      (SELECT count(*)::int FROM outbox_events
        WHERE published_at IS NULL AND recovery_fenced_at IS NULL) AS "outboxEventsFenced",
      (SELECT count(*)::int FROM notification_email_queue
        WHERE status IN ('pending', 'delayed', 'failed')) AS "emailsCanceled",
      (SELECT count(*)::int FROM notification_digest_batches
        WHERE state IN ('prepared', 'retryable')) AS "digestBatchesTerminated",
      (SELECT count(*)::int FROM replies
        WHERE publication_state IN ('requested', 'authorized')) AS "repliesCanceled",
      (SELECT count(*)::int FROM replies
        WHERE publication_state = 'sending') AS "repliesMadeAmbiguous",
      (SELECT count(*)::int FROM google_connections
        WHERE status NOT IN ('disconnected', 'reauth_required')
           OR credential_use_state <> 'none') AS "googleConnectionsFenced",
      (SELECT count(*)::int FROM authorization_execution_permits
        WHERE state IN ('admitted', 'started')) AS "googleExecutionPermitsFenced",
      (SELECT count(*)::int FROM google_credential_source_operations
        WHERE state IN ('registered', 'provider_started', 'provider_outcome_ambiguous')) AS "googleSourceOperationsFenced",
      (SELECT count(*)::int FROM credential_revoke_permits
        WHERE state IN ('dormant', 'active', 'dispatching')) AS "googleRevokePermitsFenced",
      (SELECT count(*)::int FROM gbp_import_requests request
        WHERE request.status IN ('queued', 'processing')
           OR EXISTS (
             SELECT 1 FROM gbp_import_request_items item
             WHERE item.organization_id = request.organization_id
               AND item.import_job_id = request.id
               AND (item.status IN ('pending', 'processing')
                 OR item.outcome_code = 'temporarily_unavailable')
           )) AS "googleImportV2ParentsFenced",
      (SELECT count(*)::int FROM gbp_import_request_items
        WHERE status IN ('pending', 'processing')
           OR outcome_code = 'temporarily_unavailable') AS "googleImportV2ItemsFenced",
      (SELECT count(*)::int FROM ai_operations
        WHERE budget_settled_at IS NULL
          AND reserved_micros > 0
          AND state = 'pending') AS "aiIssuedPermitsReleased",
      (SELECT count(*)::int FROM ai_operations
        WHERE budget_settled_at IS NULL
          AND reserved_micros > 0
          AND state = 'executing') AS "aiConsumedPermitsMadeAmbiguous",
      (SELECT count(*)::int FROM ai_operations
        WHERE state IN ('pending', 'executing', 'succeeded_pending_delivery')) AS "aiOperationsFenced",
      0::int AS "aiBackfillRunsStalled"
  `)
  return countsFromRow(result.rows[0] as CountRow | undefined)
}

type RecoveryRunDriverRow = Readonly<{
  id: string
  generation: number
  source_release_sha: string
  operator_id: string
  correlation_id: string
  counts: RecoveryFenceCounts
  completed_at: Date | string
}>

function resultFromRow(
  row: RecoveryRunDriverRow,
  replayed: boolean,
): RecoveryFenceResult {
  return {
    id: row.id,
    generation: Number(row.generation),
    replayed,
    counts: countsFromRow(row.counts as unknown as CountRow),
    completedAt:
      row.completed_at instanceof Date ? row.completed_at : new Date(row.completed_at),
  }
}

/**
 * Atomically rotate the recovery generation and fence every restored
 * authentication/external-effect authority. The source tuple is convergent:
 * a replay re-scans under the same run and accumulates evidence. A
 * transaction-scoped advisory lock serializes attempts.
 */
export async function applyRecoveryFence(
  db: Database,
  input: RecoveryFenceInput,
  completeImports: (
    tx: import('#/shared/outbox/commit').Tx,
    now: Date,
  ) => Promise<{ items: number; parents: number }>,
): Promise<RecoveryFenceResult> {
  validateRecoveryFenceInput(input)
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('repkey.restore-recovery-fence'))`,
    )

    const existing = await tx.execute(sql`
      SELECT id, generation, source_release_sha,
             source_manifest_sha256, restore_point_at, operator_id,
             correlation_id, counts, completed_at
      FROM recovery_runs
      WHERE id = ${input.runId}::uuid
         OR generation = ${input.generation}
         OR (
           source_manifest_sha256 = ${input.sourceManifestSha256}
           AND restore_point_at = ${input.restorePointAt}
         )
      FOR UPDATE
    `)
    const existingRows = existing.rows as Array<
      RecoveryRunDriverRow & {
        source_manifest_sha256: string
        restore_point_at: Date | string
      }
    >
    const existingRow = existingRows.find(
      (row) =>
        row.id === input.runId &&
        row.generation === input.generation &&
        row.source_release_sha === input.sourceReleaseSha &&
        row.source_manifest_sha256 === input.sourceManifestSha256 &&
        new Date(row.restore_point_at).getTime() === input.restorePointAt.getTime() &&
        row.operator_id === input.operatorId &&
        row.correlation_id === input.correlationId,
    )
    if (existingRows.length > 0 && (!existingRow || existingRows.length > 1)) {
      throw new Error('recovery run identity, generation, or source binding conflicts')
    }

    const runId = input.runId
    if (existingRow) {
      // Exact post-commit retry: re-scan and accumulate newly resurrected
      // authority under the same reviewed run; callers surface `replayed`.
    } else {
      const generationResult = await tx.execute(sql`
        SELECT COALESCE(MAX(generation), 0)::int + 1 AS generation
        FROM recovery_runs
      `)
      const generation = Number(
        (generationResult.rows[0] as { generation?: number | string } | undefined)
          ?.generation,
      )
      if (generation !== input.generation) {
        throw new Error('reviewed recovery generation is stale')
      }

      await tx.execute(sql`
        INSERT INTO recovery_runs (
          id, generation, source_release_sha, source_manifest_sha256,
          restore_point_at, operator_id, correlation_id, counts, completed_at
        ) VALUES (
          ${input.runId}::uuid, ${input.generation}, ${input.sourceReleaseSha},
          ${input.sourceManifestSha256}, ${input.restorePointAt}, ${input.operatorId},
          ${input.correlationId}, ${JSON.stringify(ZERO_COUNTS)}::jsonb, clock_timestamp()
        )
      `)
    }

    const sessions = await tx.execute(sql`DELETE FROM session RETURNING id`)
    const verificationTokens = await tx.execute(
      sql`DELETE FROM verification RETURNING id`,
    )
    const invitations = await tx.execute(sql`
      UPDATE invitation
      SET status = 'canceled'
      WHERE status = 'pending'
      RETURNING id
    `)
    const emails = await tx.execute(sql`
      UPDATE notification_email_queue
      SET status = 'cancelled',
          provider_state = 'restore_recovery_fence',
          suppression_reason = 'restore_recovery_fence',
          next_attempt_at = NULL,
          updated_at = clock_timestamp()
      WHERE status IN ('pending', 'delayed', 'failed')
      RETURNING id
    `)
    const digestBatches = await tx.execute(sql`
      UPDATE notification_digest_batches
      SET state = 'terminal',
          outcome_class = 'restore_recovery_fence',
          terminal_reason = 'restore_recovery_fence',
          failed_at = clock_timestamp(),
          updated_at = clock_timestamp()
      WHERE state IN ('prepared', 'retryable')
      RETURNING id
    `)
    const repliesCanceled = await tx.execute(sql`
      UPDATE replies
      SET publication_state = 'cancelled',
          publication_last_error_class = NULL,
          reconcile_due_at = NULL,
          updated_at = clock_timestamp()
      WHERE publication_state IN ('requested', 'authorized')
      RETURNING id
    `)
    const repliesAmbiguous = await tx.execute(sql`
      UPDATE replies
      SET publication_state = 'ambiguous',
          publication_last_error_class = 'ambiguous',
          reconcile_due_at = clock_timestamp(),
          updated_at = clock_timestamp()
      WHERE publication_state = 'sending'
      RETURNING id
    `)

    // Restored OAuth tokens may be older than the provider's live generation.
    // No content/reply call is allowed until a fresh OAuth reauthorization.
    const connections = await tx.execute(sql`
      UPDATE google_connections
      SET status = 'reauth_required',
          credential_use_state = 'none',
          lifecycle_version = lifecycle_version + 1,
          access_version = access_version + 1,
          credential_generation = credential_generation + 1,
          status_reason = 'restore_recovery_fence',
          status_changed_at = clock_timestamp(),
          updated_at = clock_timestamp()
      WHERE status NOT IN ('disconnected', 'reauth_required')
         OR credential_use_state <> 'none'
      RETURNING id
    `)
    const googlePermits = await tx.execute(sql`
      UPDATE authorization_execution_permits
      SET state = 'fenced', fenced_at = clock_timestamp()
      WHERE state IN ('admitted', 'started')
      RETURNING id
    `)
    const googleSources = await tx.execute(sql`
      UPDATE google_credential_source_operations
      SET state = 'terminal',
          terminal_at = clock_timestamp(),
          outcome_code = 'restore_recovery_fence',
          updated_at = clock_timestamp()
      WHERE state IN ('registered', 'provider_started', 'provider_outcome_ambiguous')
      RETURNING id
    `)
    const googleRevokes = await tx.execute(sql`
      UPDATE credential_revoke_permits
      SET state = CASE
            WHEN state = 'dispatching' THEN 'cleanup_ambiguous'::credential_revoke_permit_state
            ELSE 'confirmed_not_sent'::credential_revoke_permit_state
          END,
          token_hmac_key_version = NULL,
          token_hmac = NULL,
          send_authorization_expires_at = NULL,
          terminal_at = clock_timestamp(),
          outcome_code = 'restore_recovery_fence',
          updated_at = clock_timestamp()
      WHERE state IN ('dormant', 'active', 'dispatching')
      RETURNING id
    `)

    const googleImports = await completeImports(tx, new Date())

    // A restore invalidates every in-flight AI operation. Age active
    // reservations into the shared reaper, then cancel the operation rows.
    await tx.execute(sql`
      UPDATE ai_operations
      SET budget_reserved_at = clock_timestamp() - interval '16 minutes'
      WHERE budget_settled_at IS NULL
        AND reserved_micros > 0
        AND state IN ('pending', 'executing', 'succeeded_pending_delivery')
    `)
    const aiReservationsReleased = await reapStaleAiReservations(tx)
    const activeAiOperationsFenced = await tx.execute(sql`
      UPDATE ai_operations
      SET state = 'cancelled',
          failure_code = 'restore_recovery_fence',
          next_attempt_at = NULL,
          updated_at = clock_timestamp()
      WHERE state IN ('pending', 'executing', 'succeeded_pending_delivery')
      RETURNING id
    `)

    // Last: fence every unpublished fact, including purge/lifecycle facts
    // created earlier in this isolated verification invocation.
    const outbox = await tx.execute(sql`
      UPDATE outbox_events
      SET recovery_fence_run_id = ${runId}::uuid,
          recovery_fenced_at = clock_timestamp(),
          lease_owner = NULL,
          leased_at = NULL,
          lease_expires_at = NULL
      WHERE published_at IS NULL AND recovery_fenced_at IS NULL
      RETURNING id
    `)

    const deltaCounts: RecoveryFenceCounts = {
      sessionsInvalidated: sessions.rows.length,
      verificationTokensInvalidated: verificationTokens.rows.length,
      invitationsCanceled: invitations.rows.length,
      outboxEventsFenced: outbox.rows.length,
      emailsCanceled: emails.rows.length,
      digestBatchesTerminated: digestBatches.rows.length,
      repliesCanceled: repliesCanceled.rows.length,
      repliesMadeAmbiguous: repliesAmbiguous.rows.length,
      googleConnectionsFenced: connections.rows.length,
      googleExecutionPermitsFenced: googlePermits.rows.length,
      googleSourceOperationsFenced: googleSources.rows.length,
      googleRevokePermitsFenced: googleRevokes.rows.length,
      googleImportV2ParentsFenced: googleImports.parents,
      googleImportV2ItemsFenced: googleImports.items,
      aiIssuedPermitsReleased: aiReservationsReleased,
      aiConsumedPermitsMadeAmbiguous: 0,
      aiOperationsFenced: activeAiOperationsFenced.rows.length,
      aiBackfillRunsStalled: 0,
    }
    const counts = existingRow
      ? addCounts(countsFromRow(existingRow.counts as unknown as CountRow), deltaCounts)
      : deltaCounts
    const completed = await tx.execute(sql`
      UPDATE recovery_runs
      SET counts = ${JSON.stringify(counts)}::jsonb,
          completed_at = clock_timestamp()
      WHERE id = ${runId}::uuid
      RETURNING id, generation, source_release_sha, counts, completed_at
    `)
    const row = completed.rows[0] as RecoveryRunDriverRow | undefined
    if (!row) throw new Error('could not complete recovery run')
    return resultFromRow(row, existingRow !== undefined)
  })
}
