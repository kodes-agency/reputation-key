import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import {
  organizationId as toOrganizationId,
  propertyId as toPropertyId,
  reviewId as toReviewId,
} from '#/shared/domain/ids'
import {
  MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1,
  MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1,
} from '#/shared/ai-review-source-contract'
import { insertOutboxRow } from '#/shared/outbox/commit'
import type {
  ReviewAnalysisBackfillCandidate,
  ReviewAnalysisBackfillContext,
  ReviewAnalysisBackfillSession,
  ReviewAnalysisBackfillStorePort,
} from '../../application/ports/ai-review-analysis-backfill.port'
import { aiReviewAnalysisBackfillRequested } from '../../domain/events'

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

function safeInteger(value: unknown, field: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed)) {
    throw new Error(`Review analysis backfill read an unsafe ${field}`)
  }
  return parsed
}

/**
 * Reviews this property can actually be re-analysed on, mirroring the
 * eligibility `readForAi` applies at consume time: current source epoch,
 * retained (unexpired) content, text present, and within the canonical/raw
 * source byte budgets. Anything else settles terminal without a provider call,
 * so admitting it would only burn a sequence.
 */
function eligibleReviewsSql(
  organizationId: string,
  propertyId: string,
  sourceEpoch: number,
) {
  return sql`
    FROM reviews AS review
    WHERE review.organization_id = ${organizationId}
      AND review.property_id = ${propertyId}::uuid
      AND review.source_epoch = ${sourceEpoch}
      AND review.text IS NOT NULL
      AND review.content_expires_at > transaction_timestamp()
      AND review.ai_source_byte_length <= ${MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1}
      AND (
        COALESCE(octet_length(review.text), 0)::bigint
        + COALESCE(octet_length(review.language_code), 0)::bigint
        + COALESCE(octet_length(review.reviewer_name), 0)::bigint
      ) <= ${MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1}
  `
}

function createSession(
  tx: Tx,
  organizationId: OrganizationId,
  propertyId: PropertyId,
  idGen: () => string,
): ReviewAnalysisBackfillSession {
  // Set by readContext under the property lock; every later statement in the
  // session is fenced to it.
  let sourceEpoch: number | null = null
  const UNFENCED = 'Review analysis backfill session used before readContext'

  return {
    async readContext(): Promise<ReviewAnalysisBackfillContext> {
      // FOR UPDATE is the whole contiguity guarantee:
      // `lock_review_ai_analysis_head_v1` locks this same row, so no concurrent
      // review upsert can allocate a sequence between here and commit.
      const property = await tx.execute(sql`
        SELECT source_epoch, lifecycle_state, google_binding_state, deleted_at
        FROM properties
        WHERE organization_id = ${organizationId}
          AND id = ${propertyId}::uuid
        FOR UPDATE
      `)
      const propertyRow = property.rows[0] as
        Readonly<Record<string, unknown>> | undefined
      if (!propertyRow) throw new Error('Review analysis backfill property not found')
      sourceEpoch = safeInteger(propertyRow.source_epoch, 'properties.source_epoch')

      const enablementResult = await tx.execute(sql`
        SELECT state, capabilities, authorized_source_epoch, review_analysis_epoch,
               analysis_start_sequence, state_version, authorization_lineage_id
        FROM merchant_ai_enablement
        WHERE organization_id = ${organizationId}
          AND property_id = ${propertyId}::uuid
        FOR UPDATE
      `)
      const enablementRow = enablementResult.rows[0] as
        Readonly<Record<string, unknown>> | undefined

      // The accountable member this backfill will record: the actor of the
      // consent it replays, plus that actor's `member.role` for this
      // organization (null when they are not a member at all).
      //
      // The LATEST genuine merchant consent decision at or below the head, and
      // never an `analysis_backfill` row. A backfill is not a consent decision,
      // so it must not inherit from another backfill: on an append-only lineage
      // that lets one bad run poison every later run, which is exactly what
      // happened on the closed beta. This selection is the same one
      // `reposition_merchant_ai_analysis_watermark_v1` makes inside the
      // transaction, deliberately — the use case aborts the whole backfill if
      // the two ever disagree, and predicting a different row from the one SQL
      // writes would make that guard fire on every run.
      //
      // The role is diagnostic attribution only, never the authority verdict.
      // The use case obtains that verdict through Identity's effective
      // permission/property-scope adapter, and the authoritative check stays in
      // `reposition_merchant_ai_analysis_watermark_v1` under this same lock.
      const consentActorRow = enablementRow
        ? ((
            await tx.execute(sql`
              SELECT evidence.state_version, evidence.actor_user_id,
                     member.role AS member_role
              FROM merchant_ai_consent_evidence AS evidence
              LEFT JOIN member
                ON member."organizationId" = ${organizationId}
                AND member."userId" = evidence.actor_user_id
              WHERE evidence.authorization_lineage_id
                      = ${String(enablementRow.authorization_lineage_id)}::uuid
                AND evidence.state_version
                      <= ${safeInteger(enablementRow.state_version, 'state_version')}
                AND evidence.transition_kind
                      IN ('enable', 'change', 'revoke', 'restore_reset')
              ORDER BY evidence.state_version DESC
              LIMIT 1
              FOR SHARE OF evidence
            `)
          ).rows[0] as Readonly<Record<string, unknown>> | undefined)
        : undefined

      const headResult = await tx.execute(sql`
        SELECT head_sequence
        FROM review_ai_analysis_heads
        WHERE organization_id = ${organizationId}
          AND property_id = ${propertyId}::uuid
          AND source_epoch = ${sourceEpoch}
        FOR SHARE
      `)
      const headRow = headResult.rows[0] as Readonly<Record<string, unknown>> | undefined

      const countResult = await tx.execute(sql`
        SELECT count(*)::bigint AS eligible
        ${eligibleReviewsSql(organizationId, propertyId, sourceEpoch)}
      `)

      // Reads pin to the enablement's current review-analysis epoch, so these
      // are exactly the daily rows the bumped epoch makes historical.
      const aggregateResult = await tx.execute(sql`
        SELECT count(*)::bigint AS existing
        FROM ai_property_daily_aggregates
        WHERE organization_id = ${organizationId}
          AND property_id = ${propertyId}::uuid
          AND source_epoch = ${sourceEpoch}
          AND review_analysis_epoch = ${
            enablementRow
              ? safeInteger(enablementRow.review_analysis_epoch, 'review_analysis_epoch')
              : 0
          }
      `)

      return {
        propertySourceEpoch: sourceEpoch,
        propertyActive:
          propertyRow.deleted_at === null &&
          propertyRow.lifecycle_state === 'active' &&
          propertyRow.google_binding_state === 'active',
        enablement: enablementRow
          ? {
              state: String(enablementRow.state),
              capabilities: (enablementRow.capabilities as ReadonlyArray<string>) ?? [],
              authorizedSourceEpoch: safeInteger(
                enablementRow.authorized_source_epoch,
                'authorized_source_epoch',
              ),
              reviewAnalysisEpoch: safeInteger(
                enablementRow.review_analysis_epoch,
                'review_analysis_epoch',
              ),
              analysisStartSequence: safeInteger(
                enablementRow.analysis_start_sequence,
                'analysis_start_sequence',
              ),
              stateVersion: safeInteger(enablementRow.state_version, 'state_version'),
              authorizationLineageId: String(enablementRow.authorization_lineage_id),
              consentActor:
                consentActorRow && consentActorRow.actor_user_id !== null
                  ? {
                      userId: String(consentActorRow.actor_user_id),
                      stateVersion: safeInteger(
                        consentActorRow.state_version,
                        'consent decision state_version',
                      ),
                      // NULL when the LEFT JOIN found no member row at all.
                      memberRole:
                        consentActorRow.member_role === null ||
                        consentActorRow.member_role === undefined
                          ? null
                          : String(consentActorRow.member_role),
                    }
                  : null,
            }
          : null,
        analysisHeadSequence: headRow
          ? safeInteger(headRow.head_sequence, 'head_sequence')
          : 0,
        eligibleReviewCount: safeInteger(
          (countResult.rows[0] as Readonly<Record<string, unknown>>).eligible,
          'eligible review count',
        ),
        existingDailyAggregateRowCount: safeInteger(
          (aggregateResult.rows[0] as Readonly<Record<string, unknown>>).existing,
          'existing daily aggregate row count',
        ),
      }
    },

    async listCandidates(limit) {
      if (sourceEpoch === null) throw new Error(UNFENCED)
      const result = await tx.execute(sql`
        SELECT review.id, review.source_revision, review.analysis_sequence
        ${eligibleReviewsSql(organizationId, propertyId, sourceEpoch)}
        ORDER BY review.reviewed_at ASC, review.id ASC
        LIMIT ${limit}
      `)
      return result.rows.map((raw): ReviewAnalysisBackfillCandidate => {
        const row = raw as Readonly<Record<string, unknown>>
        return {
          reviewId: toReviewId(String(row.id)),
          sourceRevision: safeInteger(row.source_revision, 'reviews.source_revision'),
          storedAnalysisSequence: safeInteger(
            row.analysis_sequence,
            'reviews.analysis_sequence',
          ),
        }
      })
    },

    async repositionWatermark(input) {
      const result = await tx.execute(sql`
        SELECT *
        FROM reposition_merchant_ai_analysis_watermark_v1(
          ${organizationId},
          ${propertyId}::uuid,
          ${input.reasonCode},
          ${input.idempotencyKey},
          ${input.requestHash},
          ${input.occurredAt.toISOString()}::timestamptz
        )
      `)
      const row = result.rows[0] as Readonly<Record<string, unknown>> | undefined
      if (!row) throw new Error('Review analysis watermark reposition returned no row')
      return {
        sourceEpoch: safeInteger(row.source_epoch, 'source_epoch'),
        analysisStartSequence: safeInteger(
          row.analysis_start_sequence,
          'analysis_start_sequence',
        ),
        reviewAnalysisEpoch: safeInteger(
          row.review_analysis_epoch,
          'review_analysis_epoch',
        ),
        stateVersion: safeInteger(row.state_version, 'state_version'),
        consentActorUserId: String(row.consent_actor_user_id),
      }
    },

    async allocateAnalysisSequence() {
      if (sourceEpoch === null) throw new Error(UNFENCED)
      const result = await tx.execute(sql`
        SELECT lock_review_ai_analysis_head_v1(
          ${organizationId},
          ${propertyId}::uuid,
          ${sourceEpoch}
        ) AS analysis_sequence
      `)
      const row = result.rows[0] as Readonly<Record<string, unknown>> | undefined
      const allocated = safeInteger(row?.analysis_sequence, 'allocated analysis sequence')
      if (allocated <= 0) {
        throw new Error('Review analysis backfill allocated a non-positive sequence')
      }
      return allocated
    },

    async emitBackfillEvent(input) {
      // `analysis_sequence` is the ONLY review column this command writes, and
      // writing it is not optional: `expectationDenial`
      // (review/infrastructure/repositories/review.repository.ts) denies
      // `analysis_sequence_changed` unless the stored pointer equals the
      // event's sequence, and `analyze-review-event` turns any non-available
      // source into a terminal `policy_disabled`. A backfill event on a fresh
      // sequence would be dead on arrival without this.
      //
      // Deliberately NOT written: `last_fetched_at`, `content_expires_at`,
      // `source_epoch`, `source_revision`, `source_seen_generation`,
      // `content_hash`, `text`, `translated_text`, `expires_at`, `updated_at`.
      // Nothing about the review changed — only the analysis plane is being
      // replayed — and the `reviews_purge_ai_reply_drafts` trigger (migration
      // 0053) fires only on `source_epoch` / `source_revision` /
      // `content_expires_at`, so it stays inert for this write.
      const updated = await tx.execute(sql`
        UPDATE reviews
        SET analysis_sequence = ${input.analysisSequence}
        WHERE organization_id = ${organizationId}
          AND property_id = ${propertyId}::uuid
          AND id = ${input.reviewId}::uuid
          AND source_epoch = ${input.sourceEpoch}
          AND source_revision = ${input.sourceRevision}
      `)
      if (updated.rowCount !== 1) {
        throw new Error(
          `Review analysis backfill could not repoint review ${input.reviewId} — it changed under the backfill`,
        )
      }

      const event = aiReviewAnalysisBackfillRequested({
        organizationId,
        propertyId,
        reviewId: input.reviewId,
        sourceEpoch: input.sourceEpoch,
        sourceRevision: input.sourceRevision,
        analysisSequence: input.analysisSequence,
        occurredAt: input.occurredAt,
        correlationId: input.correlationId,
      })
      await insertOutboxRow(tx, event, { recordedAt: input.occurredAt })
    },

    async readActiveRun() {
      const result = await tx.execute(sql`
        SELECT id, source_epoch, review_analysis_epoch, analysis_start_sequence,
               requested_review_count, emitted_review_count, skipped_review_count,
               recovered_review_count, current_analysis_sequence,
               current_review_id, current_emitted_at, correlation_id
        FROM ai_review_analysis_backfill_runs
        WHERE organization_id = ${organizationId}
          AND property_id = ${propertyId}::uuid
          AND state = 'running'
        FOR UPDATE
      `)
      const row = result.rows[0] as Readonly<Record<string, unknown>> | undefined
      if (!row) return null
      const emittedAt = row.current_emitted_at
      return {
        id: String(row.id),
        sourceEpoch: safeInteger(row.source_epoch, 'run source_epoch'),
        reviewAnalysisEpoch: safeInteger(
          row.review_analysis_epoch,
          'run review_analysis_epoch',
        ),
        analysisStartSequence: safeInteger(
          row.analysis_start_sequence,
          'run analysis_start_sequence',
        ),
        requestedReviewCount: safeInteger(
          row.requested_review_count,
          'requested_review_count',
        ),
        emittedReviewCount: safeInteger(row.emitted_review_count, 'emitted_review_count'),
        skippedReviewCount: safeInteger(row.skipped_review_count, 'skipped_review_count'),
        recoveredReviewCount: safeInteger(
          row.recovered_review_count,
          'recovered_review_count',
        ),
        currentAnalysisSequence:
          row.current_analysis_sequence === null
            ? null
            : safeInteger(row.current_analysis_sequence, 'current_analysis_sequence'),
        currentReviewId:
          row.current_review_id === null
            ? null
            : toReviewId(String(row.current_review_id)),
        currentEmittedAtEpochMillis:
          emittedAt instanceof Date
            ? emittedAt.getTime()
            : emittedAt === null || emittedAt === undefined
              ? null
              : Date.parse(String(emittedAt)),
        correlationId: String(row.correlation_id),
      }
    },

    async openRun(input) {
      const runId = idGen()
      const orderedReviewIds = input.orderedReviewIds.map(String)
      if (orderedReviewIds.length === 0) {
        throw new Error('Review analysis backfill cannot open an empty run')
      }
      if (new Set(orderedReviewIds).size !== orderedReviewIds.length) {
        throw new Error('Review analysis backfill membership contains a duplicate review')
      }
      // Expand-phase dual write: canonical rows are written explicitly below,
      // while the retained array remains readable by an old worker during a
      // rolling deploy/rollback. The transaction-local marker tells 0119's
      // old-binary mirror not to insert the same canonical rows a second time.
      await tx.execute(sql`
        SELECT set_config(
          'repkey.ai_review_backfill_membership_writer',
          'canonical-v1',
          true
        )
      `)
      const opened = await tx.execute(sql`
        WITH opened_run AS (
          INSERT INTO ai_review_analysis_backfill_runs (
            id, organization_id, property_id, source_epoch, review_analysis_epoch,
            analysis_start_sequence, review_ids, requested_review_count,
            state, reason_code, correlation_id, created_at, updated_at
          ) VALUES (
            ${runId}::uuid, ${organizationId}, ${propertyId}::uuid,
            ${input.sourceEpoch}, ${input.reviewAnalysisEpoch},
            ${input.analysisStartSequence},
            ${sql.param(orderedReviewIds)}::uuid[],
            ${orderedReviewIds.length}, 'running', ${input.reasonCode},
            ${input.correlationId}::uuid, ${input.occurredAt}, ${input.occurredAt}
          )
          RETURNING id, organization_id, property_id
        ), inserted_memberships AS (
          INSERT INTO ai_review_analysis_backfill_run_memberships (
            run_id, organization_id, property_id, ordinal, review_id, created_at
          )
          SELECT opened_run.id, opened_run.organization_id, opened_run.property_id,
                 pinned.ordinality - 1, pinned.review_id, ${input.occurredAt}
          FROM opened_run
          CROSS JOIN LATERAL unnest(${sql.param(orderedReviewIds)}::uuid[])
            WITH ORDINALITY AS pinned(review_id, ordinality)
          RETURNING run_id
        )
        SELECT count(*)::bigint AS inserted_count FROM inserted_memberships
      `)
      const insertedCount = safeInteger(
        (opened.rows[0] as Readonly<Record<string, unknown>> | undefined)?.inserted_count,
        'inserted membership count',
      )
      if (insertedCount !== orderedReviewIds.length) {
        throw new Error(
          `Review analysis backfill wrote ${insertedCount} of ${orderedReviewIds.length} memberships`,
        )
      }
      return runId
    },

    async readRunMember(input) {
      if (!Number.isSafeInteger(input.ordinal) || input.ordinal < 0) {
        throw new Error('Review analysis backfill membership ordinal is invalid')
      }
      const result = await tx.execute(sql`
        SELECT membership.review_id,
               to_jsonb(membership)->>'source_revision' AS source_revision
        FROM ai_review_analysis_backfill_run_memberships AS membership
        WHERE membership.run_id = ${input.runId}::uuid
          AND membership.organization_id = ${organizationId}
          AND membership.property_id = ${propertyId}::uuid
          AND membership.ordinal = ${input.ordinal}
      `)
      const row = result.rows[0] as Readonly<Record<string, unknown>> | undefined
      if (!row) return null
      return {
        reviewId: toReviewId(String(row.review_id)),
        // `to_jsonb` keeps the expand binary compatible with 0119: before
        // 0137 the key is absent and legacy operator runs remain unpinned.
        sourceRevision:
          row.source_revision === null || row.source_revision === undefined
            ? null
            : safeInteger(row.source_revision, 'membership source_revision'),
      }
    },

    async readEligibleCandidate(reviewId) {
      if (sourceEpoch === null) throw new Error(UNFENCED)
      const result = await tx.execute(sql`
        SELECT review.id, review.source_revision, review.analysis_sequence
        ${eligibleReviewsSql(organizationId, propertyId, sourceEpoch)}
          AND review.id = ${String(reviewId)}::uuid
      `)
      const row = result.rows[0] as Readonly<Record<string, unknown>> | undefined
      if (!row) return null
      return {
        reviewId: toReviewId(String(row.id)),
        sourceRevision: safeInteger(row.source_revision, 'reviews.source_revision'),
        storedAnalysisSequence: safeInteger(
          row.analysis_sequence,
          'reviews.analysis_sequence',
        ),
      }
    },

    async readOutcomeState(input) {
      if (sourceEpoch === null) throw new Error(UNFENCED)
      const result = await tx.execute(sql`
        SELECT state
        FROM ai_review_analysis_outcomes
        WHERE organization_id = ${organizationId}
          AND property_id = ${propertyId}::uuid
          AND source_epoch = ${sourceEpoch}
          AND review_analysis_epoch = ${input.reviewAnalysisEpoch}
          AND analysis_sequence = ${input.analysisSequence}
      `)
      const row = result.rows[0] as Readonly<Record<string, unknown>> | undefined
      if (!row) return null
      const state = String(row.state)
      if (state !== 'pending' && state !== 'ready' && state !== 'terminal_no_result') {
        throw new Error(`Review analysis outcome carries an unknown state '${state}'`)
      }
      return state
    },

    async advanceRun(input) {
      await tx.execute(sql`
        UPDATE ai_review_analysis_backfill_runs
        SET emitted_review_count = emitted_review_count + 1,
            current_analysis_sequence = ${input.analysisSequence},
            current_review_id = ${String(input.reviewId)}::uuid,
            current_emitted_at = ${input.occurredAt},
            updated_at = ${input.occurredAt}
        WHERE id = ${input.runId}::uuid AND state = 'running'
      `)
    },

    async skipRunCandidate(input) {
      await tx.execute(sql`
        UPDATE ai_review_analysis_backfill_runs
        SET skipped_review_count = skipped_review_count + 1,
            updated_at = ${input.occurredAt}
        WHERE id = ${input.runId}::uuid AND state = 'running'
      `)
    },

    async recordRunRecovery(input) {
      await tx.execute(sql`
        UPDATE ai_review_analysis_backfill_runs
        SET recovered_review_count = recovered_review_count + 1,
            updated_at = ${input.occurredAt}
        WHERE id = ${input.runId}::uuid AND state = 'running'
      `)
    },

    async closeRun(input) {
      await tx.execute(sql`
        UPDATE ai_review_analysis_backfill_runs
        SET state = ${input.state},
            terminal_reason = ${input.terminalReason},
            terminal_at = ${input.occurredAt},
            current_analysis_sequence = NULL,
            current_review_id = NULL,
            current_emitted_at = NULL,
            updated_at = ${input.occurredAt}
        WHERE id = ${input.runId}::uuid AND state = 'running'
      `)
    },
  }
}

export const createReviewAnalysisBackfillAdapter = (
  db: Database,
  idGen: () => string,
): ReviewAnalysisBackfillStorePort => {
  return {
    runExclusive: (input, run) =>
      db.transaction((tx) =>
        run(createSession(tx, input.organizationId, input.propertyId, idGen)),
      ),
    // Lock-free on purpose: every property this returns is re-read inside its
    // own exclusive session before anything is written, so a stale row costs a
    // no-op advance and never a wrong one.
    async listRunningRuns(limit) {
      const result = await db.execute(sql`
        SELECT organization_id, property_id
        FROM ai_review_analysis_backfill_runs
        WHERE state = 'running'
        ORDER BY created_at ASC
        LIMIT ${limit}
      `)
      return result.rows.map((raw) => {
        const row = raw as Readonly<Record<string, unknown>>
        return {
          organizationId: toOrganizationId(String(row.organization_id)),
          propertyId: toPropertyId(String(row.property_id)),
        }
      })
    },
  }
}
