import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { RecoveryFenceCounts } from '#/shared/db/schema/recovery.schema'
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
  regionMovesBlocking: 0,
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
      (SELECT count(*)::int FROM ai_execution_permits
        WHERE state = 'issued') AS "aiIssuedPermitsReleased",
      (SELECT count(*)::int FROM ai_execution_permits
        WHERE state = 'consumed') AS "aiConsumedPermitsMadeAmbiguous",
      (SELECT count(*)::int FROM ai_operations
        WHERE state IN ('pending', 'executing', 'succeeded_pending_delivery')) AS "aiOperationsFenced",
      (SELECT count(*)::int FROM ai_review_analysis_backfill_runs
        WHERE state = 'running') AS "aiBackfillRunsStalled",
      (SELECT count(*)::int FROM region_moves
        WHERE state NOT IN ('completed', 'rolled_back')) AS "regionMovesBlocking"
  `)
  return countsFromRow(result.rows[0] as CountRow | undefined)
}

type RecoveryRunDriverRow = Readonly<{
  id: string
  data_cell_id: string
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
 * transaction-scoped advisory lock serializes attempts in one Data Cell.
 */
export async function applyRecoveryFence(
  db: Database,
  input: RecoveryFenceInput,
): Promise<RecoveryFenceResult> {
  validateRecoveryFenceInput(input)
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('repkey.restore-recovery-fence'), hashtext(${input.dataCellId}))`,
    )

    const existing = await tx.execute(sql`
      SELECT id, data_cell_id, generation, source_release_sha,
             source_manifest_sha256, restore_point_at, operator_id,
             correlation_id, counts, completed_at
      FROM recovery_runs
      WHERE id = ${input.runId}::uuid
         OR (data_cell_id = ${input.dataCellId} AND generation = ${input.generation})
         OR (
           data_cell_id = ${input.dataCellId}
           AND source_manifest_sha256 = ${input.sourceManifestSha256}
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
        row.data_cell_id === input.dataCellId &&
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

    const activeMoves = await tx.execute(sql`
      SELECT count(*)::int AS count
      FROM region_moves
      WHERE state NOT IN ('completed', 'rolled_back')
    `)
    if (Number((activeMoves.rows[0] as { count?: number } | undefined)?.count ?? 0) > 0) {
      throw new Error(
        'active or unresolved Data Cell move exists; resolve it before recovery fencing',
      )
    }
    const activeAiOperations = await tx.execute(sql`
      SELECT count(*)::int AS count
      FROM ai_operations
      WHERE state IN ('pending', 'executing', 'succeeded_pending_delivery')
    `)
    const activeAiOperationCount = Number(
      (activeAiOperations.rows[0] as { count?: number | string } | undefined)?.count ?? 0,
    )

    const runId = input.runId
    if (existingRow) {
      // Exact post-commit retry: re-scan and accumulate newly resurrected
      // authority under the same reviewed run; callers surface `replayed`.
    } else {
      const generationResult = await tx.execute(sql`
        SELECT COALESCE(MAX(generation), 0)::int + 1 AS generation
        FROM recovery_runs
        WHERE data_cell_id = ${input.dataCellId}
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
          id, data_cell_id, generation, source_release_sha, source_manifest_sha256,
          restore_point_at, operator_id, correlation_id, counts, completed_at
        ) VALUES (
          ${input.runId}::uuid, ${input.dataCellId}, ${input.generation}, ${input.sourceReleaseSha},
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

    // V2 imports carry both a claim/effect authority and enough protected
    // routing material to resume provider work. Reconcile a still-valid
    // Property receipt when the effect committed before the restore point;
    // otherwise cancel the item and erase every claim/authorization handle.
    // Parent counters are then reduced set-wise under the same transaction.
    await tx.execute(sql`DROP TABLE IF EXISTS pg_temp.recovery_google_import_v2_parents`)
    await tx.execute(sql`
      CREATE TEMP TABLE recovery_google_import_v2_parents ON COMMIT DROP AS
      SELECT request.organization_id, request.id
      FROM gbp_import_requests request
      WHERE request.status IN ('queued', 'processing')
         OR EXISTS (
           SELECT 1 FROM gbp_import_request_items item
           WHERE item.organization_id = request.organization_id
             AND item.import_job_id = request.id
             AND (item.status IN ('pending', 'processing')
               OR item.outcome_code = 'temporarily_unavailable')
         )
    `)
    const googleImportV2Items = await tx.execute(sql`
      WITH authority AS (
        SELECT item.organization_id, item.id,
               CASE
                 WHEN receipt.tombstone OR receipt.outcome = 'property_deleted'
                   THEN 'property_deleted'
                 WHEN receipt.outcome IN ('imported', 'relinked') THEN receipt.outcome
                 ELSE 'authorization_changed'
               END AS outcome
        FROM gbp_import_request_items item
        LEFT JOIN property_operation_receipts receipt
          ON receipt.organization_id = item.organization_id
         AND receipt.idempotency_key = item.id
         AND receipt.expires_at > clock_timestamp()
        WHERE item.status IN ('pending', 'processing')
           OR item.outcome_code = 'temporarily_unavailable'
      )
      UPDATE gbp_import_request_items item
      SET status = CASE
            WHEN authority.outcome = 'imported' THEN 'imported'::google_import_v2_item_status
            WHEN authority.outcome = 'relinked' THEN 'relinked'::google_import_v2_item_status
            ELSE 'cancelled'::google_import_v2_item_status
          END,
          outcome_code = authority.outcome::google_import_v2_outcome,
          connection_id = NULL,
          existing_property_id = NULL,
          destination_property_id = NULL,
          provider_account_suffix = NULL,
          provider_location_suffix = NULL,
          expected_connection_lifecycle_version = NULL,
          expected_connection_access_version = NULL,
          expected_credential_generation = NULL,
          expected_execution_policy_version = NULL,
              expected_actor_role = NULL,
          expected_permission_digest = NULL,
          expected_source_epoch = NULL,
          expected_profile_version = NULL,
          claim_fence = NULL,
          claim_lease_expires_at = NULL,
          first_terminal_at = COALESCE(item.first_terminal_at, clock_timestamp()),
          updated_at = clock_timestamp()
      FROM authority
      WHERE item.organization_id = authority.organization_id
        AND item.id = authority.id
      RETURNING item.id
    `)
    const googleImportV2Parents = await tx.execute(sql`
      WITH reduced AS (
        SELECT parent.organization_id, parent.id,
               count(*)::int AS total_count,
               count(*) FILTER (WHERE item.status = 'imported')::int AS imported_count,
               count(*) FILTER (WHERE item.status = 'relinked')::int AS relinked_count,
               count(*) FILTER (WHERE item.status = 'already_exists')::int AS already_exists_count,
               count(*) FILTER (WHERE item.status = 'region_unavailable')::int AS region_unavailable_count,
               count(*) FILTER (WHERE item.status = 'failed')::int AS failed_count,
               count(*) FILTER (WHERE item.status = 'cancelled')::int AS cancelled_count,
               bool_and(item.status IN ('imported', 'relinked')) AS all_success,
               bool_or(item.status IN ('imported', 'relinked', 'already_exists', 'region_unavailable')) AS has_positive,
               bool_and(item.status = 'cancelled') AS all_cancelled,
               bool_or(item.status = 'failed') AS has_failure
        FROM recovery_google_import_v2_parents candidate
        JOIN gbp_import_requests parent
          ON parent.organization_id = candidate.organization_id
         AND parent.id = candidate.id
        JOIN gbp_import_request_items item
          ON item.organization_id = parent.organization_id
         AND item.import_job_id = parent.id
        GROUP BY parent.organization_id, parent.id
      )
      UPDATE gbp_import_requests parent
      SET status = CASE
            WHEN reduced.all_success THEN 'completed'::google_import_v2_parent_status
            WHEN NOT reduced.has_positive AND reduced.all_cancelled
              THEN 'cancelled'::google_import_v2_parent_status
            WHEN NOT reduced.has_positive AND reduced.has_failure
              THEN 'failed'::google_import_v2_parent_status
            ELSE 'completed_with_issues'::google_import_v2_parent_status
          END,
          processed_count = reduced.total_count,
          pending_count = 0,
          processing_count = 0,
          imported_count = reduced.imported_count,
          relinked_count = reduced.relinked_count,
          already_exists_count = reduced.already_exists_count,
          region_unavailable_count = reduced.region_unavailable_count,
          failed_count = reduced.failed_count,
          cancelled_count = reduced.cancelled_count,
          first_terminal_at = COALESCE(parent.first_terminal_at, statement_timestamp()),
          purge_at = COALESCE(parent.first_terminal_at, statement_timestamp()) + interval '30 days',
          updated_at = clock_timestamp()
      FROM reduced
      WHERE parent.organization_id = reduced.organization_id
        AND parent.id = reduced.id
      RETURNING parent.id
    `)

    // A consumed AI permit has an unknown provider outcome. Force its lease
    // expired and use the admission plane's own authoritative reaper so cost,
    // settlement, circuit, attempt, and operation state stay atomic.
    await tx.execute(sql`DROP TABLE IF EXISTS pg_temp.recovery_issued_ai_permits`)
    await tx.execute(sql`
      UPDATE ai_execution_permits
      SET concurrency_expires_at = clock_timestamp() - interval '1 second'
      WHERE state = 'consumed'
    `)
    let aiConsumed = 0
    for (;;) {
      const reaped = await tx.execute(
        sql`SELECT reap_expired_ai_execution_permits_v1(1000)::int AS count`,
      )
      const count = Number(
        (reaped.rows[0] as { count?: number | string } | undefined)?.count ?? 0,
      )
      aiConsumed += count
      if (count < 1000) break
    }

    // Issued means the provider never received a grant. Release the reserved
    // maximum cost and cancel the corresponding attempt/operation without
    // manufacturing a provider settlement.
    await tx.execute(sql`DROP TABLE IF EXISTS pg_temp.recovery_pending_ai_operations`)
    await tx.execute(sql`
      CREATE TEMP TABLE recovery_issued_ai_permits ON COMMIT DROP AS
      SELECT permit.id, permit.operation_id
      FROM ai_execution_permits permit
      WHERE permit.state = 'issued'
    `)
    const inconsistentWindows = await tx.execute(sql`
      WITH property_totals AS (
        SELECT reservation.property_id, reservation.property_window_generation,
               SUM(reservation.maximum_cost_micros)::bigint AS amount
        FROM ai_admission_cost_reservations reservation
        JOIN recovery_issued_ai_permits candidate ON candidate.id = reservation.permit_id
        WHERE reservation.state = 'reserved' AND reservation.property_id IS NOT NULL
        GROUP BY reservation.property_id, reservation.property_window_generation
      ), organization_totals AS (
        SELECT reservation.organization_id, reservation.organization_utc_date,
               SUM(reservation.maximum_cost_micros)::bigint AS amount
        FROM ai_admission_cost_reservations reservation
        JOIN recovery_issued_ai_permits candidate ON candidate.id = reservation.permit_id
        WHERE reservation.state = 'reserved' AND reservation.organization_id IS NOT NULL
        GROUP BY reservation.organization_id, reservation.organization_utc_date
      )
      SELECT
        (SELECT count(*)::int FROM property_totals total
          LEFT JOIN ai_property_quota_windows quota_window
            ON quota_window.property_id = total.property_id
           AND quota_window.generation = total.property_window_generation
          WHERE quota_window.property_id IS NULL OR quota_window.reserved_cost_micros < total.amount)
        +
        (SELECT count(*)::int FROM organization_totals total
          LEFT JOIN ai_organization_cost_windows quota_window
            ON quota_window.organization_id = total.organization_id
           AND quota_window.utc_date = total.organization_utc_date
          WHERE quota_window.organization_id IS NULL OR quota_window.reserved_cost_micros < total.amount)
        AS count
    `)
    if (
      Number(
        (inconsistentWindows.rows[0] as { count?: number | string } | undefined)?.count ??
          0,
      ) > 0
    ) {
      throw new Error('AI reserved-cost windows are inconsistent; recovery refused')
    }
    await tx.execute(sql`
      WITH totals AS (
        SELECT reservation.property_id, reservation.property_window_generation,
               SUM(reservation.maximum_cost_micros)::bigint AS amount
        FROM ai_admission_cost_reservations reservation
        JOIN recovery_issued_ai_permits candidate ON candidate.id = reservation.permit_id
        WHERE reservation.state = 'reserved' AND reservation.property_id IS NOT NULL
        GROUP BY reservation.property_id, reservation.property_window_generation
      )
      UPDATE ai_property_quota_windows quota_window
      SET reserved_cost_micros = quota_window.reserved_cost_micros - totals.amount,
          updated_at = clock_timestamp()
      FROM totals
      WHERE quota_window.property_id = totals.property_id
        AND quota_window.generation = totals.property_window_generation
    `)
    await tx.execute(sql`
      WITH totals AS (
        SELECT reservation.organization_id, reservation.organization_utc_date,
               SUM(reservation.maximum_cost_micros)::bigint AS amount
        FROM ai_admission_cost_reservations reservation
        JOIN recovery_issued_ai_permits candidate ON candidate.id = reservation.permit_id
        WHERE reservation.state = 'reserved' AND reservation.organization_id IS NOT NULL
        GROUP BY reservation.organization_id, reservation.organization_utc_date
      )
      UPDATE ai_organization_cost_windows quota_window
      SET reserved_cost_micros = quota_window.reserved_cost_micros - totals.amount,
          updated_at = clock_timestamp()
      FROM totals
      WHERE quota_window.organization_id = totals.organization_id
        AND quota_window.utc_date = totals.organization_utc_date
    `)
    await tx.execute(sql`
      UPDATE ai_admission_cost_reservations reservation
      SET state = 'released', actual_cost_micros = 0, settled_at = clock_timestamp()
      FROM recovery_issued_ai_permits candidate
      WHERE reservation.permit_id = candidate.id AND reservation.state = 'reserved'
    `)
    await tx.execute(sql`
      UPDATE ai_operation_attempts attempt
      SET state = 'cancelled',
          failure_code = 'restore_recovery_fence',
          settled_at = clock_timestamp()
      FROM recovery_issued_ai_permits candidate
      WHERE attempt.operation_id = candidate.operation_id
        AND attempt.state = 'executing'
    `)
    await tx.execute(sql`
      UPDATE ai_operations operation
      SET state = 'cancelled',
          failure_code = 'restore_recovery_fence',
          next_attempt_at = NULL,
          updated_at = clock_timestamp()
      FROM recovery_issued_ai_permits candidate
      WHERE operation.id = candidate.operation_id
        AND operation.state IN ('pending', 'executing', 'succeeded_pending_delivery')
    `)
    await tx.execute(sql`
      UPDATE ai_canary_authorizations canary_authorization
      SET state = 'released_no_dispatch', settled_at = clock_timestamp()
      FROM recovery_issued_ai_permits candidate
      JOIN ai_operations operation ON operation.id = candidate.operation_id
      WHERE canary_authorization.id = operation.canary_authorization_id
        AND canary_authorization.state IN ('issued', 'consumed')
    `)
    await tx.execute(sql`
      UPDATE ai_canary_authorization_heads head
      SET transition_generation = transition_generation + 1,
          state = 'eligible',
          current_authorization_id = NULL,
          current_operation_id = NULL,
          current_permit_id = NULL,
          updated_at = clock_timestamp()
      FROM recovery_issued_ai_permits candidate
      WHERE head.current_permit_id = candidate.id
    `)
    const aiIssued = await tx.execute(sql`
      UPDATE ai_execution_permits permit
      SET state = 'released'
      FROM recovery_issued_ai_permits candidate
      WHERE permit.id = candidate.id AND permit.state = 'issued'
      RETURNING permit.id
    `)
    await tx.execute(sql`
      CREATE TEMP TABLE recovery_pending_ai_operations ON COMMIT DROP AS
      SELECT id
      FROM ai_operations
      WHERE state IN ('pending', 'executing', 'succeeded_pending_delivery')
    `)
    await tx.execute(sql`
      UPDATE ai_operation_attempts attempt
      SET state = 'cancelled',
          failure_code = 'restore_recovery_fence',
          settled_at = clock_timestamp()
      FROM recovery_pending_ai_operations candidate
      WHERE attempt.operation_id = candidate.id
        AND attempt.state = 'executing'
    `)
    await tx.execute(sql`
      UPDATE ai_operations operation
      SET state = 'cancelled',
          failure_code = 'restore_recovery_fence',
          next_attempt_at = NULL,
          updated_at = clock_timestamp()
      FROM recovery_pending_ai_operations candidate
      WHERE operation.id = candidate.id
      RETURNING operation.id
    `)
    const aiBackfills = await tx.execute(sql`
      UPDATE ai_review_analysis_backfill_runs
      SET state = 'stalled',
          terminal_reason = 'restore_recovery_fence',
          terminal_at = clock_timestamp(),
          updated_at = clock_timestamp()
      WHERE state = 'running'
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
      googleImportV2ParentsFenced: googleImportV2Parents.rows.length,
      googleImportV2ItemsFenced: googleImportV2Items.rows.length,
      aiIssuedPermitsReleased: aiIssued.rows.length,
      aiConsumedPermitsMadeAmbiguous: aiConsumed,
      aiOperationsFenced: activeAiOperationCount,
      aiBackfillRunsStalled: aiBackfills.rows.length,
      regionMovesBlocking: 0,
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
