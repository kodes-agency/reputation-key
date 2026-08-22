import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { outboxEvents } from '#/shared/db/schema'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import { reviewId as toReviewId } from '#/shared/domain/ids'
import {
  MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1,
  MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1,
} from '#/shared/ai-review-source-contract'
import type {
  ReviewAnalysisBackfillCandidate,
  ReviewAnalysisBackfillContext,
  ReviewAnalysisBackfillSession,
  ReviewAnalysisBackfillStorePort,
} from '../../application/ports/ai-review-analysis-backfill.port'
import type { AiReviewAnalysisBackfillRequested } from '../../domain/events'

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
      // Only the role, never the authority verdict. Owner is settled here, but
      // an admin also needs an active property grant, and identity owns the
      // grant table (ADR 0039) — the AI context must not read it. The use case
      // finishes the decision through the identity-owned
      // `PropertyAccessHolderLookup`, and the authoritative check stays in
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

      const event: AiReviewAnalysisBackfillRequested = {
        _tag: 'ai.review_analysis.backfill_requested',
        organizationId,
        propertyId,
        reviewId: input.reviewId,
        sourceEpoch: input.sourceEpoch,
        sourceRevision: input.sourceRevision,
        analysisSequence: input.analysisSequence,
      }
      await tx.insert(outboxEvents).values({
        id: randomUUID(),
        eventType: event._tag,
        eventVersion: 1,
        payload: {
          organizationId: event.organizationId,
          propertyId: event.propertyId,
          reviewId: event.reviewId,
          sourceEpoch: event.sourceEpoch,
          sourceRevision: event.sourceRevision,
          analysisSequence: event.analysisSequence,
          occurredAt: input.occurredAt.toISOString(),
          correlationId: input.correlationId,
        },
        organizationId: event.organizationId,
        propertyId: event.propertyId,
        sourceContext: 'ai',
        sourceAggregateId: event.reviewId,
        createdAt: input.occurredAt,
      })
    },
  }
}

export function createReviewAnalysisBackfillAdapter(
  db: Database,
): ReviewAnalysisBackfillStorePort {
  return {
    runExclusive: (input, run) =>
      db.transaction((tx) =>
        run(createSession(tx, input.organizationId, input.propertyId)),
      ),
  }
}
