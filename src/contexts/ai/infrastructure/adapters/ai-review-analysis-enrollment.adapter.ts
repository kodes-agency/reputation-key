import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { aiReviewAnalysisEnrollments, eventConsumerReceipts } from '#/shared/db/schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import {
  MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1,
  MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1,
} from '#/shared/ai-review-source-contract'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '#/shared/ai-operation-profiles'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { aiReviewAnalysisBackfillRequested } from '../../domain/events'
import type {
  AiAuthorizationLifecycleApplyResult,
  AiAuthorizationLifecycleTrigger,
  ReviewAnalysisEnrollmentEvidence,
  ReviewAnalysisEnrollmentFence,
  ReviewAnalysisEnrollmentReconcileResult,
  ReviewAnalysisEnrollmentStorePort,
} from '../../application/ports/ai-review-analysis-enrollment.port'
import { AI_REVIEW_ANALYSIS_ENROLLMENT_SAFETY_CEILING } from '../../application/ports/ai-review-analysis-enrollment.port'

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]
type Row = Readonly<Record<string, unknown>>

const CONSUMER_NAME = 'ai.enroll-review-analysis'
const ANALYSIS_CONSUMER = 'ai.analyze-review-event'
const BACKFILL_EVENT = 'ai.review_analysis.backfill_requested'

function safeInteger(value: unknown, field: string, minimum = 0): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`Review Analysis enrollment read an invalid ${field}`)
  }
  return parsed
}

function nullableInteger(value: unknown, field: string): number | null {
  return value === null || value === undefined ? null : safeInteger(value, field)
}

function epochMillis(value: unknown, field: string): number {
  const result = value instanceof Date ? value.getTime() : Date.parse(String(value))
  if (!Number.isSafeInteger(result)) {
    throw new Error(`Review Analysis enrollment read an invalid ${field}`)
  }
  return result
}

function nullableEpochMillis(value: unknown, field: string): number | null {
  return value === null || value === undefined ? null : epochMillis(value, field)
}

function state(value: unknown): ReviewAnalysisEnrollmentEvidence['state'] {
  if (
    value !== 'awaiting_assisted_approval' &&
    value !== 'queued' &&
    value !== 'running' &&
    value !== 'caught_up' &&
    value !== 'superseded' &&
    value !== 'stalled'
  ) {
    throw new Error('Review Analysis enrollment read an invalid state')
  }
  return value
}

function fenceFromRow(row: Row): ReviewAnalysisEnrollmentFence {
  return {
    authorizationLineageId: String(row.authorization_lineage_id),
    authorizationStateVersion: safeInteger(
      row.authorization_state_version,
      'authorization state version',
      1,
    ),
    sourceEpoch: safeInteger(row.source_epoch, 'source epoch'),
    reviewAnalysisEpoch: safeInteger(
      row.review_analysis_epoch,
      'Review Analysis epoch',
      1,
    ),
    analysisStartSequence: safeInteger(
      row.analysis_start_sequence,
      'analysis start sequence',
    ),
  }
}

function sameFence(
  left: ReviewAnalysisEnrollmentFence,
  right: ReviewAnalysisEnrollmentFence,
) {
  return (
    left.authorizationLineageId === right.authorizationLineageId &&
    left.authorizationStateVersion === right.authorizationStateVersion &&
    left.sourceEpoch === right.sourceEpoch &&
    left.reviewAnalysisEpoch === right.reviewAnalysisEpoch &&
    left.analysisStartSequence === right.analysisStartSequence
  )
}

function mapEvidence(row: Row): ReviewAnalysisEnrollmentEvidence {
  const approvalPresent = row.assisted_approved_at !== null
  return {
    id: String(row.id),
    organizationId: organizationId(String(row.organization_id)),
    propertyId: propertyId(String(row.property_id)),
    fence: fenceFromRow(row),
    state: state(row.state),
    triggerEventEnvelopeId: String(row.trigger_event_envelope_id),
    snapshotRevisionCount: safeInteger(
      row.snapshot_revision_count,
      'snapshot revision count',
    ),
    snapshotRevisionSetDigest: String(row.snapshot_revision_set_digest),
    snapshotCapturedAtEpochMillis: epochMillis(
      row.snapshot_captured_at,
      'snapshot capture time',
    ),
    safetyCeiling: safeInteger(row.safety_ceiling, 'safety ceiling', 1),
    assistedApprovalRequired: row.assisted_approval_required === true,
    assistedApproval: approvalPresent
      ? {
          approvedAtEpochMillis: epochMillis(row.assisted_approved_at, 'approval time'),
          approvedByOperatorId: String(row.assisted_approved_by),
          approvalEvidenceDigest: String(row.assisted_approval_evidence_digest),
          correlationId: String(row.assisted_approval_correlation_id),
        }
      : null,
    enrolledRevisionCount: safeInteger(
      row.enrolled_revision_count,
      'enrolled revision count',
    ),
    caughtUpEligibleRevisionCount: nullableInteger(
      row.caught_up_eligible_revision_count,
      'caught-up eligible revision count',
    ),
    caughtUpAnalysisSequence: nullableInteger(
      row.caught_up_analysis_sequence,
      'caught-up analysis sequence',
    ),
    caughtUpRevisionSetDigest:
      row.caught_up_revision_set_digest === null
        ? null
        : String(row.caught_up_revision_set_digest),
    caughtUpAtEpochMillis: nullableEpochMillis(row.caught_up_at, 'caught-up time'),
    terminalReason: row.terminal_reason === null ? null : String(row.terminal_reason),
  }
}

function eligibleReviewsSql(input: {
  organizationId: string
  propertyId: string
  sourceEpoch: number
  analysisStartSequence: number
}) {
  return sql`
    FROM reviews AS review
    WHERE review.organization_id = ${input.organizationId}
      AND review.property_id = ${input.propertyId}::uuid
      AND review.source_epoch = ${input.sourceEpoch}
      AND review.source_revision >= 1
      AND review.analysis_sequence <= ${input.analysisStartSequence}
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

async function snapshot(
  tx: Tx,
  input: {
    organizationId: string
    propertyId: string
    sourceEpoch: number
    analysisStartSequence: number
  },
): Promise<{ count: number; digest: string }> {
  const result = await tx.execute(sql`
    SELECT count(*)::bigint AS count,
           encode(
             digest(
               convert_to(
                 COALESCE(
                   string_agg(
                     review.id::text || ':' || review.source_revision::text,
                     ',' ORDER BY review.id
                   ),
                   ''
                 ),
                 'UTF8'
               ),
               'sha256'
             ),
             'hex'
           ) AS digest
    ${eligibleReviewsSql(input)}
  `)
  const row = result.rows[0] as Row | undefined
  if (!row) throw new Error('Review Analysis enrollment snapshot returned no row')
  return { count: safeInteger(row.count, 'snapshot count'), digest: String(row.digest) }
}

async function insertReceipt(
  tx: Tx,
  input: AiAuthorizationLifecycleTrigger,
  status: 'applied' | 'duplicate' | 'obsolete',
) {
  await tx
    .insert(eventConsumerReceipts)
    .values({ eventId: input.eventEnvelopeId, consumerName: CONSUMER_NAME, status })
    .onConflictDoNothing()
}

async function eraseRetiredDerivatives(
  tx: Tx,
  input: AiAuthorizationLifecycleTrigger,
  capabilities: ReadonlyArray<string>,
) {
  const reviewEnabled =
    input.authorizationState === 'enabled' && capabilities.includes('review_analysis')
  const trendsEnabled = reviewEnabled && capabilities.includes('property_trends')
  const sourceEpoch = reviewEnabled ? input.fence.sourceEpoch : -1
  const reviewEpoch = reviewEnabled ? input.fence.reviewAnalysisEpoch : -1
  const trendEpoch = trendsEnabled ? input.fence.propertyTrendsEpoch : -1

  await tx.execute(sql`
    DELETE FROM ai_property_trend_outcomes AS outcome
    USING ai_property_trend_schedules AS schedule
    WHERE outcome.schedule_id = schedule.id
      AND schedule.organization_id = ${input.organizationId}
      AND schedule.property_id = ${input.propertyId}::uuid
      AND (
        schedule.source_epoch <> ${sourceEpoch}
        OR schedule.review_analysis_epoch <> ${reviewEpoch}
        OR schedule.property_trends_epoch <> ${trendEpoch}
      )
  `)
  await tx.execute(sql`
    DELETE FROM ai_property_trend_schedules
    WHERE organization_id = ${input.organizationId}
      AND property_id = ${input.propertyId}::uuid
      AND (
        source_epoch <> ${sourceEpoch}
        OR review_analysis_epoch <> ${reviewEpoch}
        OR property_trends_epoch <> ${trendEpoch}
      )
  `)
  await tx.execute(sql`
    DELETE FROM ai_property_aggregate_contributions
    WHERE organization_id = ${input.organizationId}
      AND property_id = ${input.propertyId}::uuid
      AND (source_epoch <> ${sourceEpoch} OR review_analysis_epoch <> ${reviewEpoch})
  `)
  await tx.execute(sql`
    DELETE FROM ai_property_daily_aggregates
    WHERE organization_id = ${input.organizationId}
      AND property_id = ${input.propertyId}::uuid
      AND (source_epoch <> ${sourceEpoch} OR review_analysis_epoch <> ${reviewEpoch})
  `)
  await tx.execute(sql`
    DELETE FROM ai_property_aggregate_heads
    WHERE organization_id = ${input.organizationId}
      AND property_id = ${input.propertyId}::uuid
      AND (source_epoch <> ${sourceEpoch} OR review_analysis_epoch <> ${reviewEpoch})
  `)
  await tx.execute(sql`
    DELETE FROM ai_review_analyses
    WHERE organization_id = ${input.organizationId}
      AND property_id = ${input.propertyId}::uuid
      AND (
        source_epoch <> ${sourceEpoch}
        OR review_analysis_epoch <> ${reviewEpoch}
      )
  `)
}

function obsoleteReason(
  row: Row,
  input: AiAuthorizationLifecycleTrigger,
): Extract<AiAuthorizationLifecycleApplyResult, { status: 'obsolete' }>['reason'] | null {
  if (String(row.authorization_lineage_id) !== input.fence.authorizationLineageId) {
    return 'authorization_lineage_changed'
  }
  if (String(row.state) !== input.authorizationState) return 'authorization_state_changed'
  if (
    safeInteger(row.state_version, 'state version', 1) !==
    input.fence.authorizationStateVersion
  ) {
    return 'authorization_state_version_changed'
  }
  if (
    safeInteger(row.authorized_source_epoch, 'source epoch') !== input.fence.sourceEpoch
  ) {
    return 'source_epoch_changed'
  }
  if (
    safeInteger(row.review_analysis_epoch, 'Review Analysis epoch', 1) !==
    input.fence.reviewAnalysisEpoch
  ) {
    return 'review_analysis_epoch_changed'
  }
  if (
    safeInteger(row.reply_drafting_epoch, 'Reply Drafting epoch', 1) !==
    input.fence.replyDraftingEpoch
  ) {
    return 'reply_drafting_epoch_changed'
  }
  if (
    safeInteger(row.property_trends_epoch, 'Property Trends epoch', 1) !==
    input.fence.propertyTrendsEpoch
  ) {
    return 'property_trends_epoch_changed'
  }
  if (
    safeInteger(row.analysis_start_sequence, 'analysis start sequence') !==
    input.fence.analysisStartSequence
  ) {
    return 'analysis_start_sequence_changed'
  }
  if (
    row.deleted_at !== null ||
    row.lifecycle_state !== 'active' ||
    safeInteger(row.property_source_epoch, 'Property source epoch') !==
      input.fence.sourceEpoch
  ) {
    return 'property_inactive'
  }
  return null
}

async function catchUp(
  tx: Tx,
  row: Row,
  occurredAt: Date,
): Promise<Extract<ReviewAnalysisEnrollmentReconcileResult, { status: 'caught_up' }>> {
  const caughtUpAt = new Date(
    Math.max(
      occurredAt.getTime(),
      epochMillis(row.snapshot_captured_at, 'snapshot capture time'),
    ),
  )
  const headResult = await tx.execute(sql`
    SELECT COALESCE(head_sequence, 0)::bigint AS head_sequence
    FROM review_ai_analysis_heads
    WHERE organization_id = ${String(row.organization_id)}
      AND property_id = ${String(row.property_id)}::uuid
      AND source_epoch = ${safeInteger(row.source_epoch, 'source epoch')}
  `)
  const headSequence = safeInteger(
    (headResult.rows[0] as Row | undefined)?.head_sequence ?? 0,
    'analysis head sequence',
  )
  const count = safeInteger(row.snapshot_revision_count, 'snapshot count')
  const digestValue = String(row.snapshot_revision_set_digest)
  await tx
    .update(aiReviewAnalysisEnrollments)
    .set({
      state: 'caught_up',
      caughtUpEligibleRevisionCount: count,
      caughtUpAnalysisSequence: headSequence,
      caughtUpRevisionSetDigest: digestValue,
      caughtUpAt,
      terminalReason: 'eligible_revision_set_caught_up',
      terminalAt: caughtUpAt,
      updatedAt: caughtUpAt,
    })
    .where(eq(aiReviewAnalysisEnrollments.id, String(row.id)))
  return {
    status: 'caught_up',
    eligibleRevisionCount: count,
    caughtUpAnalysisSequence: headSequence,
    revisionSetDigest: digestValue,
  }
}

export const createReviewAnalysisEnrollmentAdapter = (
  db: Database,
  idGen: () => string,
): ReviewAnalysisEnrollmentStorePort => ({
  async applyAuthorizationLifecycle(input) {
    return db.transaction(async (tx) => {
      const duplicate = await tx.execute(sql`
        SELECT enrollment.id
        FROM event_consumer_receipts AS receipt
        LEFT JOIN ai_review_analysis_enrollments AS enrollment
          ON enrollment.trigger_event_envelope_id = receipt.event_id
        WHERE receipt.event_id = ${input.eventEnvelopeId}::uuid
          AND receipt.consumer_name = ${CONSUMER_NAME}
        LIMIT 1
      `)
      if (duplicate.rows.length > 0) {
        const row = duplicate.rows[0] as Row
        return {
          status: 'duplicate',
          enrollmentId: row.id === null || row.id === undefined ? null : String(row.id),
        }
      }

      const current = await tx.execute(sql`
        SELECT authorization.*, property.source_epoch AS property_source_epoch,
               property.lifecycle_state, property.deleted_at
        FROM merchant_ai_enablement AS authorization
        INNER JOIN properties AS property
          ON property.organization_id = authorization.organization_id
         AND property.id = authorization.property_id
        WHERE authorization.organization_id = ${input.organizationId}
          AND authorization.property_id = ${input.propertyId}::uuid
        FOR UPDATE OF authorization, property
      `)
      const row = current.rows[0] as Row | undefined
      if (!row) {
        await insertReceipt(tx, input, 'obsolete')
        return { status: 'obsolete', reason: 'authorization_absent' }
      }
      const moved = obsoleteReason(row, input)
      if (moved !== null) {
        await insertReceipt(tx, input, 'obsolete')
        return { status: 'obsolete', reason: moved }
      }

      const capabilities = Array.isArray(row.capabilities)
        ? row.capabilities.map(String)
        : []
      await eraseRetiredDerivatives(tx, input, capabilities)
      await tx.execute(sql`
        UPDATE ai_review_analysis_enrollments
        SET state = 'superseded', terminal_reason = 'authorization_changed',
            terminal_at = GREATEST(${input.occurredAt}, snapshot_captured_at),
            updated_at = GREATEST(${input.occurredAt}, created_at)
        WHERE organization_id = ${input.organizationId}
          AND property_id = ${input.propertyId}::uuid
          AND state IN ('awaiting_assisted_approval', 'queued', 'running')
          AND (
            authorization_lineage_id <> ${input.fence.authorizationLineageId}::uuid
            OR authorization_state_version <> ${input.fence.authorizationStateVersion}
            OR source_epoch <> ${input.fence.sourceEpoch}
            OR review_analysis_epoch <> ${input.fence.reviewAnalysisEpoch}
            OR analysis_start_sequence <> ${input.fence.analysisStartSequence}
          )
      `)

      if (input.authorizationState !== 'enabled') {
        await insertReceipt(tx, input, 'applied')
        return {
          status: 'applied',
          enrollment: {
            status: 'not_applicable',
            reason: 'authorization_not_enabled',
          },
        }
      }
      if (!capabilities.includes('review_analysis')) {
        await insertReceipt(tx, input, 'applied')
        return {
          status: 'applied',
          enrollment: {
            status: 'not_applicable',
            reason: 'review_analysis_not_authorized',
          },
        }
      }

      const evidence = await snapshot(tx, {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        sourceEpoch: input.fence.sourceEpoch,
        analysisStartSequence: input.fence.analysisStartSequence,
      })
      const assistedApprovalRequired =
        evidence.count > AI_REVIEW_ANALYSIS_ENROLLMENT_SAFETY_CEILING
      const enrollmentId = idGen()
      const createdAt = new Date(input.occurredAt)
      await tx
        .insert(aiReviewAnalysisEnrollments)
        .values({
          id: enrollmentId,
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          authorizationLineageId: input.fence.authorizationLineageId,
          authorizationStateVersion: input.fence.authorizationStateVersion,
          sourceEpoch: input.fence.sourceEpoch,
          reviewAnalysisEpoch: input.fence.reviewAnalysisEpoch,
          analysisStartSequence: input.fence.analysisStartSequence,
          providerDeploymentProfileVersion: AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
          triggerEventEnvelopeId: input.eventEnvelopeId,
          state: assistedApprovalRequired ? 'awaiting_assisted_approval' : 'queued',
          snapshotRevisionCount: evidence.count,
          snapshotRevisionSetDigest: evidence.digest,
          snapshotCapturedAt: createdAt,
          safetyCeiling: AI_REVIEW_ANALYSIS_ENROLLMENT_SAFETY_CEILING,
          assistedApprovalRequired,
          enrolledRevisionCount: 0,
          createdAt,
          updatedAt: createdAt,
        })
        .onConflictDoNothing()
      await insertReceipt(tx, input, 'applied')
      return {
        status: 'applied',
        enrollment: assistedApprovalRequired
          ? {
              status: 'awaiting_assisted_approval',
              enrollmentId,
              eligibleRevisionCount: evidence.count,
              safetyCeiling: AI_REVIEW_ANALYSIS_ENROLLMENT_SAFETY_CEILING,
            }
          : { status: 'queued', enrollmentId },
      }
    })
  },

  async listActionable(limit) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error('Review Analysis enrollment list limit is invalid')
    }
    const rows = await db
      .select()
      .from(aiReviewAnalysisEnrollments)
      .where(inArray(aiReviewAnalysisEnrollments.state, ['queued', 'running']))
      .orderBy(aiReviewAnalysisEnrollments.createdAt, aiReviewAnalysisEnrollments.id)
      .limit(limit)
    return rows.map((row) => ({
      id: row.id,
      organizationId: organizationId(row.organizationId),
      propertyId: propertyId(row.propertyId),
      fence: {
        authorizationLineageId: row.authorizationLineageId,
        authorizationStateVersion: row.authorizationStateVersion,
        sourceEpoch: row.sourceEpoch,
        reviewAnalysisEpoch: row.reviewAnalysisEpoch,
        analysisStartSequence: row.analysisStartSequence,
      },
      providerDeploymentProfileVersion: AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
      state: row.state as 'queued' | 'running',
    }))
  },

  async reconcile(input) {
    return db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT * FROM ai_review_analysis_enrollments
        WHERE id = ${input.enrollmentId}::uuid
          AND organization_id = ${input.organizationId}
        FOR UPDATE
      `)
      const row = locked.rows[0] as Row | undefined
      if (!row) return { status: 'superseded', reason: 'authorization_changed' }
      const storedFence = fenceFromRow(row)
      if (!sameFence(input.expectedFence, storedFence)) {
        return { status: 'superseded', reason: 'authorization_changed' }
      }
      const enrollmentState = state(row.state)
      if (enrollmentState === 'superseded') {
        return { status: 'superseded', reason: 'authorization_changed' }
      }
      if (enrollmentState === 'stalled') {
        return { status: 'stalled', reason: 'verification_inconsistent' }
      }
      if (enrollmentState === 'caught_up') {
        return {
          status: 'caught_up',
          eligibleRevisionCount: safeInteger(
            row.caught_up_eligible_revision_count,
            'caught-up count',
          ),
          caughtUpAnalysisSequence: safeInteger(
            row.caught_up_analysis_sequence,
            'caught-up sequence',
          ),
          revisionSetDigest: String(row.caught_up_revision_set_digest),
        }
      }
      if (enrollmentState === 'awaiting_assisted_approval') {
        return {
          status: 'awaiting_assisted_approval',
          eligibleRevisionCount: safeInteger(
            row.snapshot_revision_count,
            'snapshot count',
          ),
          safetyCeiling: safeInteger(row.safety_ceiling, 'safety ceiling', 1),
        }
      }

      if (enrollmentState === 'running') {
        const receipts = await tx.execute(sql`
          SELECT count(*)::bigint AS count
          FROM outbox_events AS event
          INNER JOIN event_consumer_receipts AS receipt
            ON receipt.event_id = event.id
           AND receipt.consumer_name = ${ANALYSIS_CONSUMER}
          WHERE event.payload->>'correlationId' = ${input.enrollmentId}
            AND event.event_type = ${BACKFILL_EVENT}
        `)
        const settled = safeInteger(
          (receipts.rows[0] as Row | undefined)?.count ?? 0,
          'settled event count',
        )
        const enrolled = safeInteger(row.enrolled_revision_count, 'enrolled count')
        if (settled < enrolled) return { status: 'waiting_for_replay' }
        if (settled !== enrolled) {
          return { status: 'stalled', reason: 'verification_inconsistent' }
        }
        return catchUp(tx, row, input.occurredAt)
      }

      const expectedSnapshot = await snapshot(tx, {
        organizationId: String(row.organization_id),
        propertyId: String(row.property_id),
        sourceEpoch: storedFence.sourceEpoch,
        analysisStartSequence: storedFence.analysisStartSequence,
      })
      if (
        expectedSnapshot.count !==
          safeInteger(row.snapshot_revision_count, 'snapshot count') ||
        expectedSnapshot.digest !== String(row.snapshot_revision_set_digest)
      ) {
        const terminalAt = new Date(
          Math.max(
            input.occurredAt.getTime(),
            epochMillis(row.snapshot_captured_at, 'snapshot capture time'),
          ),
        )
        await tx
          .update(aiReviewAnalysisEnrollments)
          .set({
            state: 'stalled',
            terminalReason: 'verification_inconsistent',
            terminalAt,
            updatedAt: terminalAt,
          })
          .where(eq(aiReviewAnalysisEnrollments.id, input.enrollmentId))
        return { status: 'stalled', reason: 'verification_inconsistent' }
      }
      if (expectedSnapshot.count === 0) return catchUp(tx, row, input.occurredAt)

      const candidates = await tx.execute(sql`
        SELECT review.id, review.source_revision
        ${eligibleReviewsSql({
          organizationId: String(row.organization_id),
          propertyId: String(row.property_id),
          sourceEpoch: storedFence.sourceEpoch,
          analysisStartSequence: storedFence.analysisStartSequence,
        })}
        ORDER BY review.id
        FOR UPDATE
      `)
      for (const raw of candidates.rows) {
        const candidate = raw as Row
        const allocated = await tx.execute(sql`
          SELECT lock_review_ai_analysis_head_v1(
            ${String(row.organization_id)},
            ${String(row.property_id)}::uuid,
            ${storedFence.sourceEpoch}
          ) AS sequence
        `)
        const sequence = safeInteger(
          (allocated.rows[0] as Row | undefined)?.sequence,
          'allocated analysis sequence',
          1,
        )
        const reviewId = String(candidate.id)
        const sourceRevision = safeInteger(
          candidate.source_revision,
          'source revision',
          1,
        )
        const updated = await tx.execute(sql`
          UPDATE reviews
          SET analysis_sequence = ${sequence}
          WHERE organization_id = ${String(row.organization_id)}
            AND property_id = ${String(row.property_id)}::uuid
            AND id = ${reviewId}::uuid
            AND source_epoch = ${storedFence.sourceEpoch}
            AND source_revision = ${sourceRevision}
            AND analysis_sequence <= ${storedFence.analysisStartSequence}
        `)
        if (updated.rowCount !== 1) {
          throw new Error('Review Analysis enrollment candidate changed while locked')
        }
        await insertOutboxRow(
          tx,
          aiReviewAnalysisBackfillRequested({
            organizationId: organizationId(String(row.organization_id)),
            propertyId: propertyId(String(row.property_id)),
            reviewId: reviewId as Parameters<
              typeof aiReviewAnalysisBackfillRequested
            >[0]['reviewId'],
            sourceEpoch: storedFence.sourceEpoch,
            sourceRevision,
            analysisSequence: sequence,
            occurredAt: input.occurredAt,
            correlationId: input.enrollmentId,
          }),
          { recordedAt: input.occurredAt },
        )
      }
      const updatedAt = new Date(
        Math.max(input.occurredAt.getTime(), epochMillis(row.created_at, 'created time')),
      )
      await tx
        .update(aiReviewAnalysisEnrollments)
        .set({
          state: 'running',
          enrolledRevisionCount: candidates.rows.length,
          updatedAt,
        })
        .where(eq(aiReviewAnalysisEnrollments.id, input.enrollmentId))
      return {
        status: 'replay_started',
        runId: input.enrollmentId,
        pinnedRevisionCount: candidates.rows.length,
      }
    })
  },

  async approveAssistedReplay(input) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(aiReviewAnalysisEnrollments)
        .where(
          and(
            eq(aiReviewAnalysisEnrollments.id, input.enrollmentId),
            eq(aiReviewAnalysisEnrollments.organizationId, input.organizationId),
          ),
        )
        .limit(1)
        .for('update')
      if (!row) return { status: 'refused', reason: 'enrollment_not_found' }
      const storedFence: ReviewAnalysisEnrollmentFence = {
        authorizationLineageId: row.authorizationLineageId,
        authorizationStateVersion: row.authorizationStateVersion,
        sourceEpoch: row.sourceEpoch,
        reviewAnalysisEpoch: row.reviewAnalysisEpoch,
        analysisStartSequence: row.analysisStartSequence,
      }
      if (!sameFence(input.expectedFence, storedFence)) {
        return { status: 'refused', reason: 'authorization_changed' }
      }
      if (!row.assistedApprovalRequired) {
        return { status: 'refused', reason: 'approval_not_required' }
      }
      if (row.assistedApprovedAt !== null) {
        return row.assistedApprovalEvidenceDigest === input.approvalEvidenceDigest
          ? { status: 'duplicate', enrollmentId: row.id }
          : { status: 'refused', reason: 'approval_conflict' }
      }
      if (row.state !== 'awaiting_assisted_approval') {
        return { status: 'refused', reason: 'enrollment_terminal' }
      }
      const occurredAt = new Date(
        Math.max(input.occurredAt.getTime(), row.snapshotCapturedAt.getTime()),
      )
      await tx
        .update(aiReviewAnalysisEnrollments)
        .set({
          state: 'queued',
          assistedApprovedAt: occurredAt,
          assistedApprovedBy: input.approvedByOperatorId,
          assistedApprovalEvidenceDigest: input.approvalEvidenceDigest,
          assistedApprovalCorrelationId: input.correlationId,
          updatedAt: occurredAt,
        })
        .where(eq(aiReviewAnalysisEnrollments.id, row.id))
      return { status: 'approved', enrollmentId: row.id }
    })
  },

  async markSuperseded(input) {
    const terminalAt = new Date(input.occurredAt)
    const rows = await db
      .update(aiReviewAnalysisEnrollments)
      .set({
        state: 'superseded',
        terminalReason: input.reason,
        terminalAt,
        updatedAt: terminalAt,
      })
      .where(
        and(
          eq(aiReviewAnalysisEnrollments.id, input.enrollmentId),
          eq(aiReviewAnalysisEnrollments.organizationId, input.organizationId),
          eq(
            aiReviewAnalysisEnrollments.authorizationLineageId,
            input.expectedFence.authorizationLineageId,
          ),
          eq(
            aiReviewAnalysisEnrollments.authorizationStateVersion,
            input.expectedFence.authorizationStateVersion,
          ),
          eq(aiReviewAnalysisEnrollments.sourceEpoch, input.expectedFence.sourceEpoch),
          eq(
            aiReviewAnalysisEnrollments.reviewAnalysisEpoch,
            input.expectedFence.reviewAnalysisEpoch,
          ),
          eq(
            aiReviewAnalysisEnrollments.analysisStartSequence,
            input.expectedFence.analysisStartSequence,
          ),
          inArray(aiReviewAnalysisEnrollments.state, [
            'awaiting_assisted_approval',
            'queued',
            'running',
          ]),
        ),
      )
      .returning({ id: aiReviewAnalysisEnrollments.id })
    return rows.length === 1
  },

  async readCurrent(input) {
    const result = await db.execute(sql`
      SELECT * FROM ai_review_analysis_enrollments
      WHERE organization_id = ${input.organizationId}
        AND property_id = ${input.propertyId}::uuid
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `)
    const row = result.rows[0] as Row | undefined
    return row ? mapEvidence(row) : null
  },
})
