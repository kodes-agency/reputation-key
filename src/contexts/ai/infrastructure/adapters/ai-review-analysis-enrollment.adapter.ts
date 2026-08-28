import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { eventConsumerReceipts } from '#/shared/db/schema/outbox.schema'
import {
  organizationId as toOrganizationId,
  propertyId as toPropertyId,
} from '#/shared/domain/ids'
import {
  MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1,
  MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1,
} from '#/shared/ai-review-source-contract'
import type {
  AiAuthorizationLifecycleApplyResult,
  AiAuthorizationLifecycleEvidence,
  AiAuthorizationLifecycleFence,
  AiAuthorizationLifecycleTrigger,
  AiLocalDerivativeDataClass,
  ReviewAnalysisEnrollmentEvidence,
  ReviewAnalysisEnrollmentFence,
  ReviewAnalysisEnrollmentHead,
  ReviewAnalysisEnrollmentReconcileResult,
  ReviewAnalysisEnrollmentStorePort,
} from '../../application/ports/ai-review-analysis-enrollment.port'
import {
  AI_LOCAL_DERIVATIVE_ERASURE_WINDOW_MILLIS,
  AI_REVIEW_ANALYSIS_ENROLLMENT_SAFETY_CEILING,
  EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST,
  isReviewAnalysisRevisionSetEvidence,
} from '../../application/ports/ai-review-analysis-enrollment.port'
import type { MerchantAiCapability } from '#/shared/domain/merchant-ai-capability'

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]
type Row = Readonly<Record<string, unknown>>

const CONSUMER_NAME = 'ai.enroll-review-analysis'
const CAPABILITY_ORDER = [
  'review_analysis',
  'reply_drafting',
  'property_trends',
] as const satisfies ReadonlyArray<MerchantAiCapability>
const LOCAL_DATA_CLASS_ORDER = [
  'review_analysis',
  'property_aggregate',
  'property_trend',
] as const satisfies ReadonlyArray<AiLocalDerivativeDataClass>

function safeInteger(value: unknown, field: string, minimum = 0): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`Review Analysis enrollment read an invalid ${field}`)
  }
  return parsed
}

function dateEpochMillis(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value))
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Review Analysis enrollment read an invalid ${field}`)
  }
  return parsed
}

function fenceFromRow(row: Row): ReviewAnalysisEnrollmentFence {
  return {
    authorizationLineageId: String(row.authorization_lineage_id),
    authorizationStateVersion: safeInteger(
      row.authorization_state_version,
      'authorization_state_version',
      1,
    ),
    sourceEpoch: safeInteger(row.source_epoch, 'source_epoch'),
    reviewAnalysisEpoch: safeInteger(
      row.review_analysis_epoch,
      'review_analysis_epoch',
      1,
    ),
    analysisStartSequence: safeInteger(
      row.analysis_start_sequence,
      'analysis_start_sequence',
    ),
  }
}

function sameFence(left: ReviewAnalysisEnrollmentFence, right: Row): boolean {
  return (
    left.authorizationLineageId === String(right.authorization_lineage_id) &&
    left.authorizationStateVersion ===
      safeInteger(right.state_version, 'state_version', 1) &&
    left.sourceEpoch === safeInteger(right.authorized_source_epoch, 'source_epoch') &&
    left.reviewAnalysisEpoch ===
      safeInteger(right.review_analysis_epoch, 'review_analysis_epoch', 1) &&
    left.analysisStartSequence ===
      safeInteger(right.analysis_start_sequence, 'analysis_start_sequence')
  )
}

function normalizeCapabilities(value: unknown): ReadonlyArray<MerchantAiCapability> {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error('AI authorization lifecycle read invalid capabilities')
  }
  const values = new Set(value)
  const normalized = CAPABILITY_ORDER.filter((capability) => values.has(capability))
  if (normalized.length !== value.length) {
    throw new Error('AI authorization lifecycle read invalid capabilities')
  }
  return normalized
}

function normalizeDataClasses(value: unknown): ReadonlyArray<AiLocalDerivativeDataClass> {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error('AI authorization lifecycle read invalid data classes')
  }
  const values = new Set(value)
  const normalized = LOCAL_DATA_CLASS_ORDER.filter((dataClass) => values.has(dataClass))
  if (normalized.length !== value.length) {
    throw new Error('AI authorization lifecycle read invalid data classes')
  }
  return normalized
}

function lifecycleFenceFromRow(row: Row): AiAuthorizationLifecycleFence {
  return {
    authorizationLineageId: String(row.authorization_lineage_id),
    authorizationStateVersion: safeInteger(
      row.authorization_state_version,
      'authorization_state_version',
      1,
    ),
    sourceEpoch: safeInteger(row.source_epoch, 'source_epoch'),
    reviewAnalysisEpoch: safeInteger(
      row.review_analysis_epoch,
      'review_analysis_epoch',
      1,
    ),
    replyDraftingEpoch: safeInteger(row.reply_drafting_epoch, 'reply_drafting_epoch', 1),
    propertyTrendsEpoch: safeInteger(
      row.property_trends_epoch,
      'property_trends_epoch',
      1,
    ),
    analysisStartSequence: safeInteger(
      row.analysis_start_sequence,
      'analysis_start_sequence',
    ),
  }
}

function mapLifecycleEvidence(row: Row): AiAuthorizationLifecycleEvidence {
  const authorizationState = String(row.authorization_state)
  if (
    authorizationState !== 'disabled' &&
    authorizationState !== 'enabled' &&
    authorizationState !== 'revoked'
  ) {
    throw new Error('AI authorization lifecycle read invalid state')
  }
  const transitionKind = String(row.transition_kind)
  if (
    transitionKind !== 'enable' &&
    transitionKind !== 'change' &&
    transitionKind !== 'revoke' &&
    transitionKind !== 'restore_reset' &&
    transitionKind !== 'analysis_backfill'
  ) {
    throw new Error('AI authorization lifecycle read invalid transition')
  }
  const erasureStatus = String(row.erasure_status)
  if (
    erasureStatus !== 'not_required' &&
    erasureStatus !== 'pending' &&
    erasureStatus !== 'in_progress' &&
    erasureStatus !== 'completed' &&
    erasureStatus !== 'failed'
  ) {
    throw new Error('AI authorization lifecycle read invalid erasure status')
  }
  const appliedAtEpochMillis = dateEpochMillis(row.applied_at, 'applied_at')
  if (appliedAtEpochMillis === null) {
    throw new Error('AI authorization lifecycle applied time is absent')
  }
  return {
    id: String(row.id),
    eventEnvelopeId: String(row.event_envelope_id),
    organizationId: toOrganizationId(String(row.organization_id)),
    propertyId: toPropertyId(String(row.property_id)),
    authorizationState,
    transitionKind,
    fence: lifecycleFenceFromRow(row),
    authorizedCapabilities: normalizeCapabilities(row.authorized_capabilities),
    visibleDataClasses: normalizeDataClasses(row.visible_data_classes),
    retiredDataClasses: normalizeDataClasses(row.retired_data_classes),
    erasureStatus,
    erasureDeadlineEpochMillis: dateEpochMillis(row.erasure_deadline, 'erasure_deadline'),
    appliedAtEpochMillis,
  }
}

function mapEvidence(row: Row): ReviewAnalysisEnrollmentEvidence {
  const state = String(row.state)
  if (
    state !== 'awaiting_assisted_approval' &&
    state !== 'queued' &&
    state !== 'running' &&
    state !== 'caught_up' &&
    state !== 'superseded' &&
    state !== 'stalled'
  ) {
    throw new Error(`Review Analysis enrollment carries unknown state '${state}'`)
  }
  const digest =
    row.caught_up_revision_set_digest === null ||
    row.caught_up_revision_set_digest === undefined
      ? null
      : String(row.caught_up_revision_set_digest)
  if (digest !== null && !/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error('Review Analysis enrollment carries an invalid revision digest')
  }
  const snapshotRevisionCount = safeInteger(
    row.snapshot_revision_count,
    'snapshot_revision_count',
  )
  const snapshotRevisionSetDigest = String(row.snapshot_revision_set_digest)
  if (
    !isReviewAnalysisRevisionSetEvidence({
      revisionCount: snapshotRevisionCount,
      revisionSetDigest: snapshotRevisionSetDigest,
    })
  ) {
    throw new Error('Review Analysis enrollment carries invalid snapshot evidence')
  }
  const snapshotCapturedAtEpochMillis = dateEpochMillis(
    row.snapshot_captured_at,
    'snapshot_captured_at',
  )
  if (snapshotCapturedAtEpochMillis === null) {
    throw new Error('Review Analysis enrollment snapshot capture time is absent')
  }
  const safetyCeiling = safeInteger(row.safety_ceiling, 'safety_ceiling', 1)
  const assistedApprovalRequired = row.assisted_approval_required
  if (
    typeof assistedApprovalRequired !== 'boolean' ||
    safetyCeiling !== AI_REVIEW_ANALYSIS_ENROLLMENT_SAFETY_CEILING ||
    assistedApprovalRequired !== snapshotRevisionCount > safetyCeiling
  ) {
    throw new Error('Review Analysis enrollment carries invalid approval policy')
  }
  const approvedAtEpochMillis = dateEpochMillis(
    row.assisted_approved_at,
    'assisted_approved_at',
  )
  const approvedByOperatorId =
    row.assisted_approved_by === null || row.assisted_approved_by === undefined
      ? null
      : String(row.assisted_approved_by)
  const approvalEvidenceDigest =
    row.assisted_approval_evidence_digest === null ||
    row.assisted_approval_evidence_digest === undefined
      ? null
      : String(row.assisted_approval_evidence_digest)
  const approvalCorrelationId =
    row.assisted_approval_correlation_id === null ||
    row.assisted_approval_correlation_id === undefined
      ? null
      : String(row.assisted_approval_correlation_id)
  const assistedApprovalFields = [
    approvedAtEpochMillis,
    approvedByOperatorId,
    approvalEvidenceDigest,
    approvalCorrelationId,
  ]
  const assistedApprovalPresent = assistedApprovalFields.every((value) => value !== null)
  if (
    (!assistedApprovalPresent &&
      assistedApprovalFields.some((value) => value !== null)) ||
    (assistedApprovalPresent &&
      (approvedByOperatorId!.trim() !== approvedByOperatorId ||
        approvedByOperatorId!.length === 0 ||
        !/^[0-9a-f]{64}$/u.test(approvalEvidenceDigest!))) ||
    (state === 'awaiting_assisted_approval' &&
      (!assistedApprovalRequired || assistedApprovalPresent)) ||
    ((state === 'queued' || state === 'running' || state === 'caught_up') &&
      assistedApprovalRequired &&
      !assistedApprovalPresent)
  ) {
    throw new Error('Review Analysis enrollment carries invalid approval evidence')
  }
  const caughtUpEligibleRevisionCount =
    row.caught_up_eligible_revision_count === null ||
    row.caught_up_eligible_revision_count === undefined
      ? null
      : safeInteger(
          row.caught_up_eligible_revision_count,
          'caught_up_eligible_revision_count',
        )
  if (
    (caughtUpEligibleRevisionCount === null) !== (digest === null) ||
    (caughtUpEligibleRevisionCount !== null &&
      digest !== null &&
      !isReviewAnalysisRevisionSetEvidence({
        revisionCount: caughtUpEligibleRevisionCount,
        revisionSetDigest: digest,
      }))
  ) {
    throw new Error('Review Analysis enrollment carries inconsistent revision evidence')
  }
  return {
    id: String(row.id),
    organizationId: toOrganizationId(String(row.organization_id)),
    propertyId: toPropertyId(String(row.property_id)),
    fence: fenceFromRow(row),
    state,
    triggerEventEnvelopeId: String(row.trigger_event_envelope_id),
    activeRunId:
      row.active_run_id === null || row.active_run_id === undefined
        ? null
        : String(row.active_run_id),
    snapshotRevisionCount,
    snapshotRevisionSetDigest,
    snapshotCapturedAtEpochMillis,
    safetyCeiling,
    assistedApprovalRequired,
    assistedApproval: assistedApprovalPresent
      ? {
          approvedAtEpochMillis: approvedAtEpochMillis!,
          approvedByOperatorId: approvedByOperatorId!,
          approvalEvidenceDigest: approvalEvidenceDigest!,
          correlationId: approvalCorrelationId!,
        }
      : null,
    enrolledRevisionCount: safeInteger(
      row.enrolled_revision_count,
      'enrolled_revision_count',
    ),
    caughtUpEligibleRevisionCount,
    caughtUpAnalysisSequence:
      row.caught_up_analysis_sequence === null ||
      row.caught_up_analysis_sequence === undefined
        ? null
        : safeInteger(row.caught_up_analysis_sequence, 'caught_up_analysis_sequence'),
    caughtUpRevisionSetDigest: digest,
    caughtUpAtEpochMillis: dateEpochMillis(row.caught_up_at, 'caught_up_at'),
    terminalReason:
      row.terminal_reason === null || row.terminal_reason === undefined
        ? null
        : String(row.terminal_reason),
  }
}

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
      AND review.source_revision >= 1
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

async function receiptExists(tx: Tx, eventEnvelopeId: string): Promise<boolean> {
  const result = await tx.execute(sql`
    SELECT 1 AS one
    FROM event_consumer_receipts
    WHERE event_id = ${eventEnvelopeId}::uuid
      AND consumer_name = ${CONSUMER_NAME}
    LIMIT 1
  `)
  return result.rows.length === 1
}

async function insertReceipt(
  tx: Tx,
  input: AiAuthorizationLifecycleTrigger,
  status: 'applied' | 'duplicate' | 'obsolete',
): Promise<void> {
  await tx
    .insert(eventConsumerReceipts)
    .values({
      eventId: input.eventEnvelopeId,
      consumerName: CONSUMER_NAME,
      status,
    })
    .onConflictDoNothing()
}

async function duplicateResult(
  tx: Tx,
  eventEnvelopeId: string,
): Promise<AiAuthorizationLifecycleApplyResult> {
  const result = await tx.execute(sql`
    SELECT lifecycle.id AS lifecycle_id, enrollment.id AS enrollment_id
    FROM event_consumer_receipts AS receipt
    LEFT JOIN ai_authorization_lifecycle_records AS lifecycle
      ON lifecycle.event_envelope_id = receipt.event_id
    LEFT JOIN ai_review_analysis_enrollments AS enrollment
      ON enrollment.trigger_event_envelope_id = receipt.event_id
    WHERE receipt.event_id = ${eventEnvelopeId}::uuid
      AND receipt.consumer_name = ${CONSUMER_NAME}
    LIMIT 1
  `)
  return {
    status: 'duplicate',
    lifecycleId: result.rows[0]?.lifecycle_id
      ? String(result.rows[0].lifecycle_id)
      : null,
    enrollmentId: result.rows[0]?.enrollment_id
      ? String(result.rows[0].enrollment_id)
      : null,
  }
}

async function finishObsolete(
  tx: Tx,
  input: AiAuthorizationLifecycleTrigger,
  reason: Extract<AiAuthorizationLifecycleApplyResult, { status: 'obsolete' }>['reason'],
): Promise<AiAuthorizationLifecycleApplyResult> {
  await insertReceipt(tx, input, 'obsolete')
  return { status: 'obsolete', reason }
}

async function supersedeActive(
  tx: Tx,
  input: Readonly<{
    organizationId: string
    propertyId: string
    reason: string
    occurredAt: Date
    exceptFence?: ReviewAnalysisEnrollmentFence
  }>,
): Promise<void> {
  const except = input.exceptFence
  await tx.execute(sql`
    UPDATE ai_review_analysis_enrollments
    SET state = 'superseded',
        terminal_reason = ${input.reason},
        terminal_at = GREATEST(
          ${input.occurredAt}, snapshot_captured_at, updated_at,
          transaction_timestamp()
        ),
        updated_at = GREATEST(
          ${input.occurredAt}, updated_at, transaction_timestamp()
        )
    WHERE organization_id = ${input.organizationId}
      AND property_id = ${input.propertyId}::uuid
      AND state IN ('awaiting_assisted_approval', 'queued', 'running')
      AND (
        ${except?.authorizationLineageId ?? null}::uuid IS NULL
        OR authorization_lineage_id <> ${except?.authorizationLineageId ?? null}::uuid
        OR authorization_state_version <> ${except?.authorizationStateVersion ?? null}
        OR source_epoch <> ${except?.sourceEpoch ?? null}
        OR review_analysis_epoch <> ${except?.reviewAnalysisEpoch ?? null}
        OR analysis_start_sequence <> ${except?.analysisStartSequence ?? null}
      )
  `)
}

function visibleDataClassesFor(
  state: AiAuthorizationLifecycleTrigger['authorizationState'],
  capabilities: ReadonlyArray<MerchantAiCapability>,
): ReadonlyArray<AiLocalDerivativeDataClass> {
  if (state !== 'enabled') return []
  if (capabilities.includes('property_trends')) return LOCAL_DATA_CLASS_ORDER
  return capabilities.includes('review_analysis')
    ? LOCAL_DATA_CLASS_ORDER.slice(0, 2)
    : []
}

function retiredDataClassesFor(
  previous: Row | null,
  current: Readonly<{
    state: AiAuthorizationLifecycleTrigger['authorizationState']
    capabilities: ReadonlyArray<MerchantAiCapability>
    fence: AiAuthorizationLifecycleFence
  }>,
): ReadonlyArray<AiLocalDerivativeDataClass> {
  if (!previous || previous.state !== 'enabled') return []
  const previousCapabilities = normalizeCapabilities(previous.capabilities)
  const lineageChanged =
    String(previous.authorization_lineage_id) !== current.fence.authorizationLineageId
  const sourceChanged =
    safeInteger(previous.authorized_source_epoch, 'previous authorized_source_epoch') !==
    current.fence.sourceEpoch
  const reviewGenerationChanged =
    lineageChanged ||
    sourceChanged ||
    safeInteger(previous.review_analysis_epoch, 'previous review_analysis_epoch', 1) !==
      current.fence.reviewAnalysisEpoch
  const trendGenerationChanged =
    reviewGenerationChanged ||
    safeInteger(previous.property_trends_epoch, 'previous property_trends_epoch', 1) !==
      current.fence.propertyTrendsEpoch
  const retireReview =
    previousCapabilities.includes('review_analysis') &&
    (current.state !== 'enabled' ||
      !current.capabilities.includes('review_analysis') ||
      reviewGenerationChanged)
  const retireTrend =
    previousCapabilities.includes('property_trends') &&
    (current.state !== 'enabled' ||
      !current.capabilities.includes('property_trends') ||
      trendGenerationChanged)

  return LOCAL_DATA_CLASS_ORDER.filter(
    (dataClass) =>
      (retireReview &&
        (dataClass === 'review_analysis' || dataClass === 'property_aggregate')) ||
      (retireTrend && dataClass === 'property_trend'),
  )
}

function textArraySql(values: ReadonlyArray<string>) {
  return values.length === 0
    ? sql`ARRAY[]::text[]`
    : sql`ARRAY[${sql.join(
        values.map((value) => sql`${value}`),
        sql`, `,
      )}]::text[]`
}

async function priorAuthorizationEvidence(
  tx: Tx,
  input: AiAuthorizationLifecycleTrigger,
): Promise<Row | null> {
  const priorLifecycle = await tx.execute(sql`
    SELECT 1 AS one
    FROM ai_authorization_lifecycle_records
    WHERE organization_id = ${input.organizationId}
      AND property_id = ${input.propertyId}::uuid
    LIMIT 1
  `)
  const preferImmediatePrior = priorLifecycle.rows.length > 0
  const result = await tx.execute(sql`
    SELECT authorization_lineage_id, state_version, state, capabilities,
           authorized_source_epoch, review_analysis_epoch,
           reply_drafting_epoch, property_trends_epoch
    FROM merchant_ai_consent_evidence
    WHERE organization_id = ${input.organizationId}
      AND property_id = ${input.propertyId}::uuid
      AND NOT (
        authorization_lineage_id = ${input.fence.authorizationLineageId}::uuid
        AND state_version = ${input.fence.authorizationStateVersion}
      )
      AND (${preferImmediatePrior} OR state = 'enabled')
    ORDER BY occurred_at DESC, state_version DESC, authorization_lineage_id DESC
    LIMIT 1
    FOR SHARE
  `)
  return (result.rows[0] as Row | undefined) ?? null
}

async function persistLifecycleEvidence(
  tx: Tx,
  input: AiAuthorizationLifecycleTrigger,
  authorization: Row,
  idGen: () => string,
): Promise<Readonly<{ inserted: boolean; evidence: AiAuthorizationLifecycleEvidence }>> {
  const exact = await tx.execute(sql`
    SELECT *
    FROM ai_authorization_lifecycle_records
    WHERE organization_id = ${input.organizationId}
      AND property_id = ${input.propertyId}::uuid
      AND authorization_lineage_id = ${input.fence.authorizationLineageId}::uuid
      AND authorization_state_version = ${input.fence.authorizationStateVersion}
    LIMIT 1
    FOR SHARE
  `)
  if (exact.rows[0]) {
    return {
      inserted: false,
      evidence: mapLifecycleEvidence(exact.rows[0] as Row),
    }
  }

  const capabilities = normalizeCapabilities(authorization.capabilities)
  const visibleDataClasses = visibleDataClassesFor(input.authorizationState, capabilities)
  const previous = await priorAuthorizationEvidence(tx, input)
  const retiredDataClasses = retiredDataClassesFor(previous, {
    state: input.authorizationState,
    capabilities,
    fence: input.fence,
  })
  const erasureDeadline =
    retiredDataClasses.length === 0
      ? null
      : new Date(input.occurredAt.getTime() + AI_LOCAL_DERIVATIVE_ERASURE_WINDOW_MILLIS)
  if (erasureDeadline !== null && !Number.isSafeInteger(erasureDeadline.getTime())) {
    throw new Error('AI authorization lifecycle erasure deadline is invalid')
  }
  const id = idGen()
  const priorFence = retiredDataClasses.length === 0 ? null : previous
  const inserted = await tx.execute(sql`
    INSERT INTO ai_authorization_lifecycle_records (
      id, event_envelope_id, organization_id, property_id,
      authorization_lineage_id, authorization_state_version,
      transition_kind, authorization_state, authorized_capabilities,
      source_epoch, review_analysis_epoch, reply_drafting_epoch,
      property_trends_epoch, analysis_start_sequence,
      visible_data_classes, retired_data_classes,
      previous_authorization_lineage_id,
      previous_authorization_state_version, previous_source_epoch,
      previous_review_analysis_epoch, previous_reply_drafting_epoch,
      previous_property_trends_epoch, erasure_status, erasure_deadline,
      erasure_next_attempt_at,
      applied_at, updated_at
    ) VALUES (
      ${id}::uuid, ${input.eventEnvelopeId}::uuid, ${input.organizationId},
      ${input.propertyId}::uuid, ${input.fence.authorizationLineageId}::uuid,
      ${input.fence.authorizationStateVersion},
      ${String(authorization.transition_kind)}, ${input.authorizationState},
      ${textArraySql(capabilities)}, ${input.fence.sourceEpoch},
      ${input.fence.reviewAnalysisEpoch}, ${input.fence.replyDraftingEpoch},
      ${input.fence.propertyTrendsEpoch}, ${input.fence.analysisStartSequence},
      ${textArraySql(visibleDataClasses)}, ${textArraySql(retiredDataClasses)},
      ${priorFence ? String(priorFence.authorization_lineage_id) : null}::uuid,
      ${priorFence ? safeInteger(priorFence.state_version, 'previous state_version', 1) : null},
      ${priorFence ? safeInteger(priorFence.authorized_source_epoch, 'previous source_epoch') : null},
      ${priorFence ? safeInteger(priorFence.review_analysis_epoch, 'previous review_analysis_epoch', 1) : null},
      ${priorFence ? safeInteger(priorFence.reply_drafting_epoch, 'previous reply_drafting_epoch', 1) : null},
      ${priorFence ? safeInteger(priorFence.property_trends_epoch, 'previous property_trends_epoch', 1) : null},
      ${retiredDataClasses.length === 0 ? 'not_required' : 'pending'},
      ${erasureDeadline}, ${retiredDataClasses.length === 0 ? null : input.occurredAt},
      ${input.occurredAt}, ${input.occurredAt}
    )
    ON CONFLICT (
      authorization_lineage_id, authorization_state_version,
      organization_id, property_id
    ) DO NOTHING
    RETURNING *
  `)
  if (inserted.rows[0]) {
    return {
      inserted: true,
      evidence: mapLifecycleEvidence(inserted.rows[0] as Row),
    }
  }
  const raced = await tx.execute(sql`
    SELECT *
    FROM ai_authorization_lifecycle_records
    WHERE organization_id = ${input.organizationId}
      AND property_id = ${input.propertyId}::uuid
      AND authorization_lineage_id = ${input.fence.authorizationLineageId}::uuid
      AND authorization_state_version = ${input.fence.authorizationStateVersion}
    LIMIT 1
  `)
  if (!raced.rows[0]) {
    throw new Error('AI authorization lifecycle evidence was not persisted')
  }
  return {
    inserted: false,
    evidence: mapLifecycleEvidence(raced.rows[0] as Row),
  }
}

async function applyAuthorizationLifecycle(
  db: Database,
  input: AiAuthorizationLifecycleTrigger,
  idGen: () => string,
): Promise<AiAuthorizationLifecycleApplyResult> {
  return db.transaction(async (tx) => {
    const propertyResult = await tx.execute(sql`
      SELECT source_epoch, lifecycle_state, google_binding_state, deleted_at
      FROM properties
      WHERE organization_id = ${input.organizationId}
        AND id = ${input.propertyId}::uuid
      FOR UPDATE
    `)
    if (await receiptExists(tx, input.eventEnvelopeId)) {
      return duplicateResult(tx, input.eventEnvelopeId)
    }
    const property = propertyResult.rows[0] as Row | undefined
    if (!property) return finishObsolete(tx, input, 'property_inactive')

    const authorizationResult = await tx.execute(sql`
      SELECT enablement.authorization_lineage_id, enablement.state,
             enablement.state_version, enablement.capabilities,
             enablement.authorized_source_epoch,
             enablement.review_analysis_epoch,
             enablement.reply_drafting_epoch,
             enablement.property_trends_epoch,
             enablement.analysis_start_sequence,
             enablement.provider_deployment_profile_version,
             evidence.transition_kind
      FROM merchant_ai_enablement AS enablement
      JOIN merchant_ai_consent_evidence AS evidence
        ON evidence.authorization_lineage_id = enablement.authorization_lineage_id
       AND evidence.state_version = enablement.state_version
       AND evidence.organization_id = enablement.organization_id
       AND evidence.property_id = enablement.property_id
      WHERE enablement.organization_id = ${input.organizationId}
        AND enablement.property_id = ${input.propertyId}::uuid
      FOR SHARE
    `)
    const authorization = authorizationResult.rows[0] as Row | undefined
    if (!authorization) return finishObsolete(tx, input, 'authorization_absent')
    if (
      String(authorization.authorization_lineage_id) !==
      input.fence.authorizationLineageId
    ) {
      return finishObsolete(tx, input, 'authorization_lineage_changed')
    }
    if (String(authorization.state) !== input.authorizationState) {
      return finishObsolete(tx, input, 'authorization_state_changed')
    }
    if (
      safeInteger(authorization.state_version, 'state_version', 1) !==
      input.fence.authorizationStateVersion
    ) {
      return finishObsolete(tx, input, 'authorization_state_version_changed')
    }
    if (
      safeInteger(authorization.authorized_source_epoch, 'authorized_source_epoch') !==
        input.fence.sourceEpoch ||
      safeInteger(property.source_epoch, 'property source_epoch') !==
        input.fence.sourceEpoch
    ) {
      return finishObsolete(tx, input, 'source_epoch_changed')
    }
    if (
      safeInteger(authorization.review_analysis_epoch, 'review_analysis_epoch', 1) !==
      input.fence.reviewAnalysisEpoch
    ) {
      return finishObsolete(tx, input, 'review_analysis_epoch_changed')
    }
    if (
      safeInteger(authorization.reply_drafting_epoch, 'reply_drafting_epoch', 1) !==
      input.fence.replyDraftingEpoch
    ) {
      return finishObsolete(tx, input, 'reply_drafting_epoch_changed')
    }
    if (
      safeInteger(authorization.property_trends_epoch, 'property_trends_epoch', 1) !==
      input.fence.propertyTrendsEpoch
    ) {
      return finishObsolete(tx, input, 'property_trends_epoch_changed')
    }
    if (
      safeInteger(authorization.analysis_start_sequence, 'analysis_start_sequence') !==
      input.fence.analysisStartSequence
    ) {
      return finishObsolete(tx, input, 'analysis_start_sequence_changed')
    }

    const propertyActive =
      property.deleted_at === null &&
      property.lifecycle_state === 'active' &&
      property.google_binding_state === 'active'
    if (input.authorizationState === 'enabled' && !propertyActive) {
      return finishObsolete(tx, input, 'property_inactive')
    }

    const lifecycle = await persistLifecycleEvidence(tx, input, authorization, idGen)
    // Migration 0145 seeds lifecycle evidence before publishing its replay so
    // an older rolling worker cannot win the shared enrollment receipt and
    // leave the new lifecycle state absent. When this exact seeded envelope is
    // first handled, finish enrollment/supersession and receipt normally. A
    // different envelope for an already-recorded authorization is a replay.
    if (
      !lifecycle.inserted &&
      lifecycle.evidence.eventEnvelopeId !== input.eventEnvelopeId
    ) {
      const enrollment = await tx.execute(sql`
        SELECT id
        FROM ai_review_analysis_enrollments
        WHERE organization_id = ${input.organizationId}
          AND property_id = ${input.propertyId}::uuid
          AND authorization_lineage_id = ${input.fence.authorizationLineageId}::uuid
          AND authorization_state_version = ${input.fence.authorizationStateVersion}
          AND source_epoch = ${input.fence.sourceEpoch}
          AND review_analysis_epoch = ${input.fence.reviewAnalysisEpoch}
          AND analysis_start_sequence = ${input.fence.analysisStartSequence}
        LIMIT 1
      `)
      await insertReceipt(tx, input, 'duplicate')
      return {
        status: 'duplicate',
        lifecycleId: lifecycle.evidence.id,
        enrollmentId: enrollment.rows[0]?.id ? String(enrollment.rows[0].id) : null,
      }
    }

    if (input.authorizationState !== 'enabled') {
      await supersedeActive(tx, {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        reason: 'authorization_not_enabled',
        occurredAt: input.occurredAt,
      })
      await insertReceipt(tx, input, 'applied')
      return {
        status: 'applied',
        lifecycle: lifecycle.evidence,
        enrollment: {
          status: 'not_applicable',
          reason: 'authorization_not_enabled',
        },
      }
    }
    const capabilities = Array.isArray(authorization.capabilities)
      ? authorization.capabilities.map(String)
      : []
    if (!capabilities.includes('review_analysis')) {
      await supersedeActive(tx, {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        reason: 'review_analysis_not_authorized',
        occurredAt: input.occurredAt,
      })
      await insertReceipt(tx, input, 'applied')
      return {
        status: 'applied',
        lifecycle: lifecycle.evidence,
        enrollment: {
          status: 'not_applicable',
          reason: 'review_analysis_not_authorized',
        },
      }
    }

    // The Property row remains locked for this whole transaction. Review's
    // sequence allocator takes the same lock before it can create or revise a
    // material Review, so this count/digest and the membership insert below
    // describe one exact authorization-bound frontier.
    const snapshotResult = await tx.execute(sql`
      WITH snapshot AS (
        SELECT review.id, review.source_revision, review.analysis_sequence
        ${eligibleReviewsSql(
          input.organizationId,
          input.propertyId,
          input.fence.sourceEpoch,
        )}
          AND review.analysis_sequence <= ${input.fence.analysisStartSequence}
      )
      SELECT count(*)::bigint AS revision_count,
             COALESCE(
               encode(sha256(convert_to(string_agg(
                 snapshot.id::text || ':' || snapshot.source_revision::text || ':' || snapshot.analysis_sequence::text,
                 ',' ORDER BY snapshot.id
               ), 'UTF8')), 'hex'),
               ${EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST}
             ) AS revision_set_digest
      FROM snapshot
    `)
    const snapshot = snapshotResult.rows[0] as Row
    const snapshotRevisionCount = safeInteger(
      snapshot.revision_count,
      'snapshot revision_count',
    )
    const snapshotRevisionSetDigest = String(snapshot.revision_set_digest)
    if (
      !isReviewAnalysisRevisionSetEvidence({
        revisionCount: snapshotRevisionCount,
        revisionSetDigest: snapshotRevisionSetDigest,
      })
    ) {
      throw new Error('Review Analysis enrollment snapshot evidence is invalid')
    }

    await supersedeActive(tx, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      reason: 'authorization_changed',
      occurredAt: input.occurredAt,
      exceptFence: input.fence,
    })
    const enrollmentId = idGen()
    const assistedApprovalRequired =
      snapshotRevisionCount > AI_REVIEW_ANALYSIS_ENROLLMENT_SAFETY_CEILING
    const initialState = assistedApprovalRequired
      ? 'awaiting_assisted_approval'
      : 'queued'
    const inserted = await tx.execute(sql`
      INSERT INTO ai_review_analysis_enrollments (
        id, organization_id, property_id, authorization_lineage_id,
        authorization_state_version, source_epoch, review_analysis_epoch,
        analysis_start_sequence, provider_deployment_profile_version,
        trigger_event_envelope_id, state, snapshot_revision_count,
        snapshot_revision_set_digest, snapshot_captured_at,
        safety_ceiling, assisted_approval_required,
        enrolled_revision_count, created_at, updated_at
      ) VALUES (
        ${enrollmentId}::uuid, ${input.organizationId}, ${input.propertyId}::uuid,
        ${input.fence.authorizationLineageId}::uuid,
        ${input.fence.authorizationStateVersion}, ${input.fence.sourceEpoch},
        ${input.fence.reviewAnalysisEpoch}, ${input.fence.analysisStartSequence},
        ${String(authorization.provider_deployment_profile_version)},
        ${input.eventEnvelopeId}::uuid, ${initialState}, ${snapshotRevisionCount},
        ${snapshotRevisionSetDigest}, transaction_timestamp(),
        ${AI_REVIEW_ANALYSIS_ENROLLMENT_SAFETY_CEILING},
        ${assistedApprovalRequired}, 0,
        transaction_timestamp(), transaction_timestamp()
      )
      ON CONFLICT (
        organization_id, property_id, authorization_lineage_id,
        authorization_state_version, source_epoch, review_analysis_epoch,
        analysis_start_sequence
      ) DO NOTHING
      RETURNING id
    `)
    const durableId = inserted.rows[0]?.id
      ? String(inserted.rows[0].id)
      : String(
          (
            await tx.execute(sql`
              SELECT id
              FROM ai_review_analysis_enrollments
              WHERE organization_id = ${input.organizationId}
                AND property_id = ${input.propertyId}::uuid
                AND authorization_lineage_id = ${input.fence.authorizationLineageId}::uuid
                AND authorization_state_version = ${input.fence.authorizationStateVersion}
                AND source_epoch = ${input.fence.sourceEpoch}
                AND review_analysis_epoch = ${input.fence.reviewAnalysisEpoch}
                AND analysis_start_sequence = ${input.fence.analysisStartSequence}
              LIMIT 1
            `)
          ).rows[0]?.id,
        )
    if (!durableId || durableId === 'undefined') {
      throw new Error('Review Analysis enrollment intent was not persisted')
    }
    if (inserted.rows.length === 1) {
      await tx.execute(sql`
        SELECT set_config(
          'repkey.ai_review_enrollment_membership_writer',
          'canonical-v1',
          true
        )
      `)
      const members = await tx.execute(sql`
        WITH inserted_memberships AS (
          INSERT INTO ai_review_analysis_enrollment_memberships (
            enrollment_id, organization_id, property_id, ordinal, review_id,
            source_epoch, source_revision, analysis_sequence, created_at
          )
          SELECT ${durableId}::uuid, ${input.organizationId},
                 ${input.propertyId}::uuid,
                 row_number() OVER (ORDER BY review.reviewed_at ASC, review.id ASC) - 1,
                 review.id, review.source_epoch, review.source_revision,
                 review.analysis_sequence, transaction_timestamp()
          ${eligibleReviewsSql(
            input.organizationId,
            input.propertyId,
            input.fence.sourceEpoch,
          )}
            AND review.analysis_sequence <= ${input.fence.analysisStartSequence}
          RETURNING enrollment_id
        )
        SELECT count(*)::bigint AS inserted_count
        FROM inserted_memberships
      `)
      const insertedMemberCount = safeInteger(
        (members.rows[0] as Row | undefined)?.inserted_count,
        'snapshot inserted membership count',
      )
      if (insertedMemberCount !== snapshotRevisionCount) {
        throw new Error(
          `Review Analysis enrollment captured ${insertedMemberCount} of ${snapshotRevisionCount} revisions`,
        )
      }
    }
    await insertReceipt(tx, input, 'applied')
    return {
      status: 'applied',
      lifecycle: lifecycle.evidence,
      enrollment:
        inserted.rows.length === 0
          ? { status: 'duplicate', enrollmentId: durableId }
          : assistedApprovalRequired
            ? {
                status: 'awaiting_assisted_approval',
                enrollmentId: durableId,
                eligibleRevisionCount: snapshotRevisionCount,
                safetyCeiling: AI_REVIEW_ANALYSIS_ENROLLMENT_SAFETY_CEILING,
              }
            : { status: 'queued', enrollmentId: durableId },
    }
  })
}

async function readEnrollmentForUpdate(
  tx: Tx,
  enrollmentId: string,
): Promise<Row | null> {
  const result = await tx.execute(sql`
    SELECT *
    FROM ai_review_analysis_enrollments
    WHERE id = ${enrollmentId}::uuid
    FOR UPDATE
  `)
  return (result.rows[0] as Row | undefined) ?? null
}

async function markTerminal(
  tx: Tx,
  input: Readonly<{
    enrollmentId: string
    state: 'superseded' | 'stalled'
    reason: string
    occurredAt: Date
  }>,
): Promise<void> {
  await tx.execute(sql`
    UPDATE ai_review_analysis_enrollments
    SET state = ${input.state}, terminal_reason = ${input.reason},
        terminal_at = ${input.occurredAt}, updated_at = ${input.occurredAt}
    WHERE id = ${input.enrollmentId}::uuid
      AND state IN ('awaiting_assisted_approval', 'queued', 'running')
  `)
}

async function reconcile(
  db: Database,
  input: Parameters<ReviewAnalysisEnrollmentStorePort['reconcile']>[0],
  idGen: () => string,
): Promise<ReviewAnalysisEnrollmentReconcileResult> {
  return db.transaction(async (tx) => {
    const enrollment = await readEnrollmentForUpdate(tx, input.enrollmentId)
    if (!enrollment) {
      return { status: 'stalled', reason: 'verification_inconsistent' }
    }
    const persistedFence = fenceFromRow(enrollment)
    if (
      persistedFence.authorizationLineageId !==
        input.expectedFence.authorizationLineageId ||
      persistedFence.authorizationStateVersion !==
        input.expectedFence.authorizationStateVersion ||
      persistedFence.sourceEpoch !== input.expectedFence.sourceEpoch ||
      persistedFence.reviewAnalysisEpoch !== input.expectedFence.reviewAnalysisEpoch ||
      persistedFence.analysisStartSequence !== input.expectedFence.analysisStartSequence
    ) {
      return { status: 'superseded', reason: 'authorization_changed' }
    }
    if (enrollment.state === 'caught_up') {
      return {
        status: 'caught_up',
        eligibleRevisionCount: safeInteger(
          enrollment.caught_up_eligible_revision_count,
          'caught_up_eligible_revision_count',
        ),
        caughtUpAnalysisSequence: safeInteger(
          enrollment.caught_up_analysis_sequence,
          'caught_up_analysis_sequence',
        ),
        revisionSetDigest: String(enrollment.caught_up_revision_set_digest),
      }
    }
    if (enrollment.state === 'superseded') {
      return { status: 'superseded', reason: 'authorization_changed' }
    }
    if (enrollment.state === 'stalled') {
      return { status: 'stalled', reason: 'replay_stalled' }
    }
    if (enrollment.state === 'awaiting_assisted_approval') {
      return {
        status: 'awaiting_assisted_approval',
        eligibleRevisionCount: safeInteger(
          enrollment.snapshot_revision_count,
          'snapshot_revision_count',
        ),
        safetyCeiling: safeInteger(enrollment.safety_ceiling, 'safety_ceiling', 1),
      }
    }

    const propertyResult = await tx.execute(sql`
      SELECT source_epoch, lifecycle_state, google_binding_state, deleted_at
      FROM properties
      WHERE organization_id = ${enrollment.organization_id}
        AND id = ${String(enrollment.property_id)}::uuid
      FOR UPDATE
    `)
    const property = propertyResult.rows[0] as Row | undefined
    if (
      !property ||
      property.deleted_at !== null ||
      property.lifecycle_state !== 'active' ||
      property.google_binding_state !== 'active'
    ) {
      await markTerminal(tx, {
        enrollmentId: input.enrollmentId,
        state: 'superseded',
        reason: 'property_inactive',
        occurredAt: input.occurredAt,
      })
      return { status: 'superseded', reason: 'property_inactive' }
    }
    if (
      safeInteger(property.source_epoch, 'property source_epoch') !==
      persistedFence.sourceEpoch
    ) {
      await markTerminal(tx, {
        enrollmentId: input.enrollmentId,
        state: 'superseded',
        reason: 'source_epoch_changed',
        occurredAt: input.occurredAt,
      })
      return { status: 'superseded', reason: 'source_epoch_changed' }
    }

    const authorizationResult = await tx.execute(sql`
      SELECT authorization_lineage_id, state, state_version, capabilities,
             authorized_source_epoch, review_analysis_epoch,
             analysis_start_sequence
      FROM merchant_ai_enablement
      WHERE organization_id = ${enrollment.organization_id}
        AND property_id = ${String(enrollment.property_id)}::uuid
      FOR SHARE
    `)
    const authorization = authorizationResult.rows[0] as Row | undefined
    const capabilities = Array.isArray(authorization?.capabilities)
      ? authorization.capabilities.map(String)
      : []
    if (
      !authorization ||
      authorization.state !== 'enabled' ||
      !capabilities.includes('review_analysis') ||
      !sameFence(persistedFence, authorization)
    ) {
      await markTerminal(tx, {
        enrollmentId: input.enrollmentId,
        state: 'superseded',
        reason: 'authorization_changed',
        occurredAt: input.occurredAt,
      })
      return { status: 'superseded', reason: 'authorization_changed' }
    }

    const linkedRunResult = await tx.execute(sql`
      SELECT run.id, run.state
      FROM ai_review_analysis_enrollment_replays AS replay
      JOIN ai_review_analysis_backfill_runs AS run ON run.id = replay.run_id
      WHERE replay.enrollment_id = ${input.enrollmentId}::uuid
      ORDER BY replay.created_at DESC, replay.run_id DESC
      LIMIT 1
      FOR UPDATE OF run
    `)
    const linkedRun = linkedRunResult.rows[0] as Row | undefined
    if (linkedRun?.state === 'running') return { status: 'waiting_for_replay' }
    if (linkedRun?.state === 'stalled') {
      await markTerminal(tx, {
        enrollmentId: input.enrollmentId,
        state: 'stalled',
        reason: 'replay_stalled',
        occurredAt: input.occurredAt,
      })
      return { status: 'stalled', reason: 'replay_stalled' }
    }
    if (linkedRun?.state === 'superseded') {
      await markTerminal(tx, {
        enrollmentId: input.enrollmentId,
        state: 'superseded',
        reason: 'replay_superseded',
        occurredAt: input.occurredAt,
      })
      return { status: 'superseded', reason: 'replay_superseded' }
    }

    const anotherRun = await tx.execute(sql`
      SELECT 1 AS one
      FROM ai_review_analysis_backfill_runs
      WHERE organization_id = ${enrollment.organization_id}
        AND property_id = ${String(enrollment.property_id)}::uuid
        AND state = 'running'
      LIMIT 1
      FOR UPDATE
    `)
    if (anotherRun.rows.length > 0) return { status: 'waiting_for_replay' }

    const progressResult = await tx.execute(sql`
      WITH eligible AS (
        SELECT review.id, review.source_revision, review.analysis_sequence
        ${eligibleReviewsSql(
          String(enrollment.organization_id),
          String(enrollment.property_id),
          persistedFence.sourceEpoch,
        )}
      ), qualified AS (
        SELECT eligible.id
        FROM eligible
        WHERE EXISTS (
          SELECT 1
          FROM ai_review_analysis_outcomes AS outcome
          WHERE outcome.organization_id = ${enrollment.organization_id}
            AND outcome.property_id = ${String(enrollment.property_id)}::uuid
            AND outcome.source_epoch = ${persistedFence.sourceEpoch}
            AND outcome.review_analysis_epoch = ${persistedFence.reviewAnalysisEpoch}
            AND outcome.analysis_sequence = eligible.analysis_sequence
            AND outcome.applied_aggregate_revision IS NOT NULL
            AND (
              (
                outcome.state = 'ready'
                AND EXISTS (
                  SELECT 1
                  FROM ai_review_analyses AS analysis
                  WHERE analysis.organization_id = outcome.organization_id
                    AND analysis.property_id = outcome.property_id
                    AND analysis.review_id = eligible.id
                    AND analysis.source_epoch = outcome.source_epoch
                    AND analysis.source_revision = eligible.source_revision
                    AND analysis.analysis_sequence = outcome.analysis_sequence
                    AND analysis.review_analysis_epoch = outcome.review_analysis_epoch
                    AND analysis.status = 'ready'
                )
              )
              OR (
                outcome.state = 'terminal_no_result'
                AND outcome.disposition_code = 'language_not_supported'
                AND EXISTS (
                  SELECT 1
                  FROM outbox_events AS source_event
                  WHERE source_event.id = outcome.event_envelope_id
                    AND source_event.organization_id = outcome.organization_id
                    AND source_event.property_id = outcome.property_id::text
                    AND source_event.payload->>'reviewId' = eligible.id::text
                    AND (source_event.payload->>'sourceEpoch')::integer = outcome.source_epoch
                    AND (source_event.payload->>'sourceRevision')::bigint = eligible.source_revision
                    AND (source_event.payload->>'analysisSequence')::bigint = outcome.analysis_sequence
                )
              )
            )
        )
      ), snapshot_pending AS (
        SELECT eligible.id
        FROM ai_review_analysis_enrollment_memberships AS membership
        JOIN eligible ON eligible.id = membership.review_id
          AND eligible.source_revision = membership.source_revision
          AND eligible.analysis_sequence = membership.analysis_sequence
        LEFT JOIN qualified ON qualified.id = eligible.id
        WHERE membership.enrollment_id = ${input.enrollmentId}::uuid
          AND membership.organization_id = ${enrollment.organization_id}
          AND membership.property_id = ${String(enrollment.property_id)}::uuid
          AND membership.source_epoch = ${persistedFence.sourceEpoch}
          AND qualified.id IS NULL
      )
      SELECT
        (SELECT count(*)::bigint FROM snapshot_pending) AS unenrolled_count,
        count(*) FILTER (
          WHERE qualified.id IS NULL
            AND EXISTS (
              SELECT 1 FROM ai_review_analysis_outcomes AS failed
              WHERE failed.organization_id = ${enrollment.organization_id}
                AND failed.property_id = ${String(enrollment.property_id)}::uuid
                AND failed.source_epoch = ${persistedFence.sourceEpoch}
                AND failed.review_analysis_epoch = ${persistedFence.reviewAnalysisEpoch}
                AND failed.analysis_sequence = eligible.analysis_sequence
                AND failed.state = 'terminal_no_result'
                AND failed.applied_aggregate_revision IS NOT NULL
            )
        )::bigint AS failed_count,
        count(*) FILTER (
          WHERE eligible.analysis_sequence > ${persistedFence.analysisStartSequence}
            AND qualified.id IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM ai_review_analysis_outcomes AS failed
              WHERE failed.organization_id = ${enrollment.organization_id}
                AND failed.property_id = ${String(enrollment.property_id)}::uuid
                AND failed.source_epoch = ${persistedFence.sourceEpoch}
                AND failed.review_analysis_epoch = ${persistedFence.reviewAnalysisEpoch}
                AND failed.analysis_sequence = eligible.analysis_sequence
                AND failed.state = 'terminal_no_result'
                AND failed.applied_aggregate_revision IS NOT NULL
            )
        )::bigint AS pending_count,
        count(*)::bigint AS eligible_count,
        COALESCE(
          encode(sha256(convert_to(string_agg(
            eligible.id::text || ':' || eligible.source_revision::text || ':' || eligible.analysis_sequence::text,
            ',' ORDER BY eligible.id
          ), 'UTF8')), 'hex'),
          ${EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST}
        ) AS revision_set_digest
      FROM eligible
      LEFT JOIN qualified ON qualified.id = eligible.id
    `)
    const progress = progressResult.rows[0] as Row
    const failedCount = safeInteger(progress.failed_count, 'failed_count')
    if (failedCount > 0) {
      await markTerminal(tx, {
        enrollmentId: input.enrollmentId,
        state: 'stalled',
        reason: 'eligible_revision_terminal_without_analysis',
        occurredAt: input.occurredAt,
      })
      return { status: 'stalled', reason: 'verification_inconsistent' }
    }
    const pendingCount = safeInteger(progress.pending_count, 'pending_count')
    if (pendingCount > 0) return { status: 'waiting_for_replay' }
    const unenrolledCount = safeInteger(progress.unenrolled_count, 'unenrolled_count')

    if (unenrolledCount > 0) {
      if (unenrolledCount > 2_147_483_647) {
        await markTerminal(tx, {
          enrollmentId: input.enrollmentId,
          state: 'stalled',
          reason: 'eligible_revision_count_unsafe',
          occurredAt: input.occurredAt,
        })
        return { status: 'stalled', reason: 'verification_inconsistent' }
      }
      const runId = idGen()
      await tx.execute(sql`
        SELECT set_config(
          'repkey.ai_review_backfill_membership_writer',
          'canonical-v1',
          true
        )
      `)
      const opened = await tx.execute(sql`
        WITH candidates AS (
          SELECT membership.review_id AS id, membership.source_revision,
                 row_number() OVER (ORDER BY membership.ordinal) - 1 AS ordinal
          FROM ai_review_analysis_enrollment_memberships AS membership
          JOIN reviews AS review
            ON review.organization_id = membership.organization_id
            AND review.property_id = membership.property_id
            AND review.id = membership.review_id
            AND review.source_epoch = membership.source_epoch
            AND review.source_revision = membership.source_revision
            AND review.analysis_sequence = membership.analysis_sequence
          WHERE membership.enrollment_id = ${input.enrollmentId}::uuid
            AND membership.organization_id = ${enrollment.organization_id}
            AND membership.property_id = ${String(enrollment.property_id)}::uuid
            AND membership.source_epoch = ${persistedFence.sourceEpoch}
            AND review.text IS NOT NULL
            AND review.content_expires_at > transaction_timestamp()
            AND review.ai_source_byte_length <= ${MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1}
            AND (
              COALESCE(octet_length(review.text), 0)::bigint
              + COALESCE(octet_length(review.language_code), 0)::bigint
              + COALESCE(octet_length(review.reviewer_name), 0)::bigint
            ) <= ${MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1}
            AND NOT EXISTS (
              SELECT 1
              FROM ai_review_analysis_outcomes AS outcome
              WHERE outcome.organization_id = membership.organization_id
                AND outcome.property_id = membership.property_id
                AND outcome.source_epoch = membership.source_epoch
                AND outcome.review_analysis_epoch = ${persistedFence.reviewAnalysisEpoch}
                AND outcome.analysis_sequence = membership.analysis_sequence
                AND outcome.applied_aggregate_revision IS NOT NULL
                AND (
                  (
                    outcome.state = 'ready'
                    AND EXISTS (
                      SELECT 1
                      FROM ai_review_analyses AS analysis
                      WHERE analysis.organization_id = outcome.organization_id
                        AND analysis.property_id = outcome.property_id
                        AND analysis.review_id = membership.review_id
                        AND analysis.source_epoch = outcome.source_epoch
                        AND analysis.source_revision = membership.source_revision
                        AND analysis.analysis_sequence = outcome.analysis_sequence
                        AND analysis.review_analysis_epoch = outcome.review_analysis_epoch
                        AND analysis.status = 'ready'
                    )
                  )
                  OR (
                    outcome.state = 'terminal_no_result'
                    AND outcome.disposition_code = 'language_not_supported'
                    AND EXISTS (
                      SELECT 1
                      FROM outbox_events AS source_event
                      WHERE source_event.id = outcome.event_envelope_id
                        AND source_event.organization_id = outcome.organization_id
                        AND source_event.property_id = outcome.property_id::text
                        AND source_event.payload->>'reviewId' = membership.review_id::text
                        AND (source_event.payload->>'sourceEpoch')::integer = outcome.source_epoch
                        AND (source_event.payload->>'sourceRevision')::bigint = membership.source_revision
                        AND (source_event.payload->>'analysisSequence')::bigint = outcome.analysis_sequence
                    )
                  )
                )
            )
        ), opened_run AS (
          INSERT INTO ai_review_analysis_backfill_runs (
            id, organization_id, property_id, source_epoch, review_analysis_epoch,
            analysis_start_sequence, review_ids, requested_review_count,
            state, reason_code, correlation_id, created_at, updated_at
          ) VALUES (
            ${runId}::uuid, ${enrollment.organization_id},
            ${String(enrollment.property_id)}::uuid, ${persistedFence.sourceEpoch},
            ${persistedFence.reviewAnalysisEpoch},
            ${persistedFence.analysisStartSequence}, ARRAY[]::uuid[],
            ${unenrolledCount}, 'running', 'first_enablement_enrollment_v1',
            ${input.correlationId}::uuid, ${input.occurredAt}, ${input.occurredAt}
          )
          RETURNING id, organization_id, property_id
        ), inserted_memberships AS (
          INSERT INTO ai_review_analysis_backfill_run_memberships (
            run_id, organization_id, property_id, ordinal, review_id,
            source_revision, created_at
          )
          SELECT opened_run.id, opened_run.organization_id, opened_run.property_id,
                 candidates.ordinal, candidates.id, candidates.source_revision,
                 ${input.occurredAt}
          FROM opened_run
          CROSS JOIN candidates
          RETURNING run_id
        )
        SELECT count(*)::bigint AS inserted_count
        FROM inserted_memberships
      `)
      const insertedCount = safeInteger(
        (opened.rows[0] as Row | undefined)?.inserted_count,
        'inserted membership count',
      )
      if (insertedCount !== unenrolledCount) {
        throw new Error(
          `Review Analysis enrollment pinned ${insertedCount} of ${unenrolledCount} revisions`,
        )
      }
      await tx.execute(sql`
        INSERT INTO ai_review_analysis_enrollment_replays (
          enrollment_id, run_id, organization_id, property_id, created_at
        ) VALUES (
          ${input.enrollmentId}::uuid, ${runId}::uuid,
          ${enrollment.organization_id}, ${String(enrollment.property_id)}::uuid,
          ${input.occurredAt}
        )
      `)
      await tx.execute(sql`
        UPDATE ai_review_analysis_enrollments
        SET state = 'running',
            enrolled_revision_count = enrolled_revision_count + ${insertedCount},
            updated_at = ${input.occurredAt}
        WHERE id = ${input.enrollmentId}::uuid
          AND state IN ('queued', 'running')
      `)
      return {
        status: 'replay_started',
        runId,
        pinnedRevisionCount: insertedCount,
      }
    }

    const headResult = await tx.execute(sql`
      SELECT head_sequence
      FROM review_ai_analysis_heads
      WHERE organization_id = ${enrollment.organization_id}
        AND property_id = ${String(enrollment.property_id)}::uuid
        AND source_epoch = ${persistedFence.sourceEpoch}
      FOR SHARE
    `)
    const headSequence = safeInteger(
      (headResult.rows[0] as Row | undefined)?.head_sequence,
      'analysis head_sequence',
    )
    const cursorResult = await tx.execute(sql`
      SELECT terminal_analysis_sequence
      FROM ai_review_event_cursors
      WHERE organization_id = ${enrollment.organization_id}
        AND property_id = ${String(enrollment.property_id)}::uuid
        AND source_epoch = ${persistedFence.sourceEpoch}
        AND review_analysis_epoch = ${persistedFence.reviewAnalysisEpoch}
      FOR SHARE
    `)
    const terminalSequence = cursorResult.rows[0]
      ? safeInteger(
          (cursorResult.rows[0] as Row).terminal_analysis_sequence,
          'terminal_analysis_sequence',
        )
      : persistedFence.analysisStartSequence
    if (terminalSequence !== headSequence) return { status: 'waiting_for_replay' }

    const eligibleCount = safeInteger(progress.eligible_count, 'eligible_count')
    const revisionSetDigest = String(progress.revision_set_digest)
    if (
      !isReviewAnalysisRevisionSetEvidence({
        revisionCount: eligibleCount,
        revisionSetDigest,
      })
    ) {
      throw new Error('Review Analysis enrollment revision-set digest is invalid')
    }
    await tx.execute(sql`
      UPDATE ai_review_analysis_enrollments
      SET state = 'caught_up',
          caught_up_eligible_revision_count = ${eligibleCount},
          caught_up_analysis_sequence = ${headSequence},
          caught_up_revision_set_digest = ${revisionSetDigest},
          caught_up_at = ${input.occurredAt},
          terminal_reason = 'eligible_revision_set_caught_up',
          terminal_at = ${input.occurredAt},
          updated_at = ${input.occurredAt}
      WHERE id = ${input.enrollmentId}::uuid
        AND state IN ('queued', 'running')
    `)
    return {
      status: 'caught_up',
      eligibleRevisionCount: eligibleCount,
      caughtUpAnalysisSequence: headSequence,
      revisionSetDigest,
    }
  })
}

export const createReviewAnalysisEnrollmentAdapter = (
  db: Database,
  idGen: () => string,
): ReviewAnalysisEnrollmentStorePort => {
  return {
    applyAuthorizationLifecycle: (input) => applyAuthorizationLifecycle(db, input, idGen),

    async readCurrentLifecycle(input) {
      const result = await db.execute(sql`
        SELECT lifecycle.*
        FROM ai_authorization_lifecycle_records AS lifecycle
        JOIN merchant_ai_enablement AS enablement
          ON enablement.organization_id = lifecycle.organization_id
         AND enablement.property_id = lifecycle.property_id
         AND enablement.authorization_lineage_id = lifecycle.authorization_lineage_id
         AND enablement.state_version = lifecycle.authorization_state_version
         AND enablement.state = lifecycle.authorization_state
         AND enablement.capabilities = lifecycle.authorized_capabilities
         AND enablement.authorized_source_epoch = lifecycle.source_epoch
         AND enablement.review_analysis_epoch = lifecycle.review_analysis_epoch
         AND enablement.reply_drafting_epoch = lifecycle.reply_drafting_epoch
         AND enablement.property_trends_epoch = lifecycle.property_trends_epoch
         AND enablement.analysis_start_sequence = lifecycle.analysis_start_sequence
        WHERE lifecycle.organization_id = ${input.organizationId}
          AND lifecycle.property_id = ${input.propertyId}::uuid
        LIMIT 1
      `)
      return result.rows[0] ? mapLifecycleEvidence(result.rows[0] as Row) : null
    },

    async listActionable(limit) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
        throw new Error('Review Analysis enrollment scan limit is invalid')
      }
      const result = await db.execute(sql`
        SELECT id, organization_id, property_id, authorization_lineage_id,
               authorization_state_version, source_epoch, review_analysis_epoch,
               analysis_start_sequence, provider_deployment_profile_version, state
        FROM ai_review_analysis_enrollments
        WHERE state IN ('queued', 'running')
        ORDER BY created_at ASC, id ASC
        LIMIT ${limit}
      `)
      return result.rows.map((raw): ReviewAnalysisEnrollmentHead => {
        const row = raw as Row
        return {
          id: String(row.id),
          organizationId: toOrganizationId(String(row.organization_id)),
          propertyId: toPropertyId(String(row.property_id)),
          fence: fenceFromRow(row),
          providerDeploymentProfileVersion: String(
            row.provider_deployment_profile_version,
          ),
          state: row.state === 'running' ? 'running' : 'queued',
        }
      })
    },

    reconcile: (input) => reconcile(db, input, idGen),

    async approveAssistedReplay(input) {
      return db.transaction(async (tx) => {
        const enrollment = await readEnrollmentForUpdate(tx, input.enrollmentId)
        if (!enrollment) {
          return { status: 'refused', reason: 'enrollment_not_found' }
        }
        const persistedFence = fenceFromRow(enrollment)
        if (
          persistedFence.authorizationLineageId !==
            input.expectedFence.authorizationLineageId ||
          persistedFence.authorizationStateVersion !==
            input.expectedFence.authorizationStateVersion ||
          persistedFence.sourceEpoch !== input.expectedFence.sourceEpoch ||
          persistedFence.reviewAnalysisEpoch !==
            input.expectedFence.reviewAnalysisEpoch ||
          persistedFence.analysisStartSequence !==
            input.expectedFence.analysisStartSequence
        ) {
          return { status: 'refused', reason: 'authorization_changed' }
        }

        const approvedAt = dateEpochMillis(
          enrollment.assisted_approved_at,
          'assisted_approved_at',
        )
        if (approvedAt !== null) {
          const exactReplay =
            String(enrollment.assisted_approved_by) === input.approvedByOperatorId &&
            String(enrollment.assisted_approval_evidence_digest) ===
              input.approvalEvidenceDigest
          return exactReplay
            ? { status: 'duplicate', enrollmentId: input.enrollmentId }
            : { status: 'refused', reason: 'approval_conflict' }
        }
        if (enrollment.state === 'superseded' || enrollment.state === 'stalled') {
          return { status: 'refused', reason: 'enrollment_terminal' }
        }
        if (enrollment.state !== 'awaiting_assisted_approval') {
          return { status: 'refused', reason: 'approval_not_required' }
        }
        const snapshotCapturedAt = dateEpochMillis(
          enrollment.snapshot_captured_at,
          'snapshot_captured_at',
        )
        const updatedAt = dateEpochMillis(enrollment.updated_at, 'updated_at')
        if (
          snapshotCapturedAt === null ||
          updatedAt === null ||
          input.occurredAt.getTime() < Math.max(snapshotCapturedAt, updatedAt)
        ) {
          return { status: 'refused', reason: 'approval_time_invalid' }
        }

        const propertyResult = await tx.execute(sql`
          SELECT source_epoch, lifecycle_state, google_binding_state, deleted_at
          FROM properties
          WHERE organization_id = ${enrollment.organization_id}
            AND id = ${String(enrollment.property_id)}::uuid
          FOR UPDATE
        `)
        const property = propertyResult.rows[0] as Row | undefined
        if (
          !property ||
          property.deleted_at !== null ||
          property.lifecycle_state !== 'active' ||
          property.google_binding_state !== 'active'
        ) {
          await markTerminal(tx, {
            enrollmentId: input.enrollmentId,
            state: 'superseded',
            reason: 'property_inactive',
            occurredAt: input.occurredAt,
          })
          return { status: 'refused', reason: 'property_inactive' }
        }

        const authorizationResult = await tx.execute(sql`
          SELECT authorization_lineage_id, state, state_version, capabilities,
                 authorized_source_epoch, review_analysis_epoch,
                 analysis_start_sequence
          FROM merchant_ai_enablement
          WHERE organization_id = ${enrollment.organization_id}
            AND property_id = ${String(enrollment.property_id)}::uuid
          FOR SHARE
        `)
        const authorization = authorizationResult.rows[0] as Row | undefined
        const capabilities = Array.isArray(authorization?.capabilities)
          ? authorization.capabilities.map(String)
          : []
        if (
          !authorization ||
          authorization.state !== 'enabled' ||
          !capabilities.includes('review_analysis') ||
          !sameFence(persistedFence, authorization) ||
          safeInteger(property.source_epoch, 'property source_epoch') !==
            persistedFence.sourceEpoch
        ) {
          await markTerminal(tx, {
            enrollmentId: input.enrollmentId,
            state: 'superseded',
            reason: 'authorization_changed',
            occurredAt: input.occurredAt,
          })
          return { status: 'refused', reason: 'authorization_changed' }
        }

        const approved = await tx.execute(sql`
          UPDATE ai_review_analysis_enrollments
          SET state = 'queued',
              assisted_approved_at = ${input.occurredAt},
              assisted_approved_by = ${input.approvedByOperatorId},
              assisted_approval_evidence_digest = ${input.approvalEvidenceDigest},
              assisted_approval_correlation_id = ${input.correlationId}::uuid,
              updated_at = ${input.occurredAt}
          WHERE id = ${input.enrollmentId}::uuid
            AND state = 'awaiting_assisted_approval'
            AND assisted_approved_at IS NULL
          RETURNING id
        `)
        if (approved.rows.length !== 1) {
          return { status: 'refused', reason: 'approval_conflict' }
        }
        return { status: 'approved', enrollmentId: input.enrollmentId }
      })
    },

    async markSuperseded(input) {
      const result = await db.execute(sql`
        UPDATE ai_review_analysis_enrollments
        SET state = 'superseded', terminal_reason = ${input.reason},
            terminal_at = ${input.occurredAt}, updated_at = ${input.occurredAt}
        WHERE id = ${input.enrollmentId}::uuid
          AND authorization_lineage_id = ${input.expectedFence.authorizationLineageId}::uuid
          AND authorization_state_version = ${input.expectedFence.authorizationStateVersion}
          AND source_epoch = ${input.expectedFence.sourceEpoch}
          AND review_analysis_epoch = ${input.expectedFence.reviewAnalysisEpoch}
          AND analysis_start_sequence = ${input.expectedFence.analysisStartSequence}
          AND state IN ('awaiting_assisted_approval', 'queued', 'running')
        RETURNING id
      `)
      return result.rows.length === 1
    },

    async readCurrent(input) {
      const result = await db.execute(sql`
        SELECT enrollment.*,
               active_run.run_id AS active_run_id
        FROM ai_review_analysis_enrollments AS enrollment
        LEFT JOIN LATERAL (
          SELECT replay.run_id
          FROM ai_review_analysis_enrollment_replays AS replay
          JOIN ai_review_analysis_backfill_runs AS run ON run.id = replay.run_id
          WHERE replay.enrollment_id = enrollment.id
            AND run.state = 'running'
          ORDER BY replay.created_at DESC, replay.run_id DESC
          LIMIT 1
        ) AS active_run ON true
        WHERE enrollment.organization_id = ${input.organizationId}
          AND enrollment.property_id = ${input.propertyId}::uuid
        ORDER BY enrollment.created_at DESC, enrollment.id DESC
        LIMIT 1
      `)
      const row = result.rows[0] as Row | undefined
      return row ? mapEvidence(row) : null
    },
  }
}
