import { and, asc, eq, gt, inArray, lte, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  googleReplyObservationHeads,
  googleReplyObservations,
  materialReviewRevisions,
  replies,
  reviewProviderSubjects,
  reviews,
  reviewSourceContents,
  reviewSourceObservations,
} from '#/shared/db/schema/review.schema'
import { retentionRuns } from '#/shared/db/schema/review-sync.schema'
import { reviewLifecycleRecoveryExecutions } from '#/shared/db/schema/recovery.schema'
import { properties } from '#/shared/db/schema/property.schema'
import { organizationId, propertyId, reviewId, type ReviewId } from '#/shared/domain/ids'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import type {
  ReviewSourceContentLifecycleScope,
  ReviewSourceContentLifecycleInspection,
  ReviewSourceContentLifecycleStore,
  ReviewSourceContentShadowFinding,
  ReviewSourceContentState,
} from '../../application/ports/source-content-lifecycle-store.port'
import { reviewSourceTransitioned } from '../../domain/events'
import { eraseReviewSourceContent } from '../review-source-content-store'
import { lockReplyTruthScope } from '../reply-truth-serialization'
import { REVIEW_SOURCE_CONTENT_LIFECYCLE_RETENTION_POLICY_VERSION } from '../../application/use-cases/run-source-content-lifecycle'

const MAX_INSPECTION_PAGE_SIZE = 101
const MAX_APPLY_PAGE_SIZE = 100

type InspectionRow = Readonly<{
  reviewId: string
  createdAt: Date
  sourceContentState: string
  sourceCacheClock: Date | null
  sourceCachePresent: boolean
  compatibilityMatches: boolean
  observationPresent: boolean
  observationMatches: boolean
  materialRevisionPresent: boolean
  materialRevisionMatches: boolean
  activeGoogleSyncReplyPresent: boolean
  activeGovernedGoogleReplyHeadPresent: boolean
  tombstoneCompatibilityContentPresent: boolean
  tombstoneObservationContentPresent: boolean
  tombstoneMaterialContentPresent: boolean
  tombstoneGoogleReplyContentPresent: boolean
  tombstoneGoogleSyncReplyPresent: boolean
}>

function sourceContentState(value: string): ReviewSourceContentState {
  if (value !== 'active' && value !== 'source_expired' && value !== 'provider_deleted') {
    throw new Error(`Unknown Review source-content state '${value}'`)
  }
  return value
}

function findingsFor(row: InspectionRow): ReviewSourceContentShadowFinding[] {
  if (row.sourceContentState === 'active') {
    const findings: ReviewSourceContentShadowFinding[] = []
    if (!row.sourceCachePresent) findings.push('active_source_cache_missing')
    else if (!row.compatibilityMatches) findings.push('active_compatibility_drift')
    if (!row.observationPresent) findings.push('active_observation_missing')
    else if (!row.observationMatches) findings.push('active_observation_drift')
    if (!row.materialRevisionPresent) {
      findings.push('active_material_revision_missing')
    } else if (!row.materialRevisionMatches) {
      findings.push('active_material_revision_drift')
    }
    if (row.activeGoogleSyncReplyPresent) {
      findings.push(
        row.activeGovernedGoogleReplyHeadPresent
          ? 'active_google_sync_reply_redundant'
          : 'active_google_sync_reply_unreconciled',
      )
    }
    return findings
  }

  const findings: ReviewSourceContentShadowFinding[] = []
  if (row.sourceCachePresent) findings.push('tombstone_source_cache_present')
  if (row.tombstoneCompatibilityContentPresent) {
    findings.push('tombstone_compatibility_content_present')
  }
  if (row.tombstoneObservationContentPresent) {
    findings.push('tombstone_observation_content_present')
  }
  if (row.tombstoneMaterialContentPresent) {
    findings.push('tombstone_material_content_present')
  }
  if (row.tombstoneGoogleReplyContentPresent) {
    findings.push('tombstone_google_reply_content_present')
  }
  if (row.tombstoneGoogleSyncReplyPresent) {
    findings.push('tombstone_google_sync_reply_present')
  }
  return findings
}

function toInspection(row: InspectionRow): ReviewSourceContentLifecycleInspection {
  const state = sourceContentState(row.sourceContentState)
  return {
    reviewId: reviewId(row.reviewId),
    createdAt: row.createdAt,
    sourceContentState: state,
    // The nullable compatibility clock participates in parity reporting only.
    // It must never authorize erasure when the canonical expand-cache row is
    // missing: that state remains explicitly unverifiable and fails closed.
    lifecycleClock: state === 'active' ? row.sourceCacheClock : null,
    shadowFindings: findingsFor(row),
  }
}

function cursorCondition(
  after: Readonly<{ createdAt: Date; reviewId: ReviewId }> | null,
) {
  return after == null
    ? undefined
    : or(
        gt(reviews.createdAt, after.createdAt),
        and(eq(reviews.createdAt, after.createdAt), gt(reviews.id, after.reviewId)),
      )
}

function lifecycleScopeCondition(scope: ReviewSourceContentLifecycleScope) {
  switch (scope.kind) {
    case 'expired':
      return scope.organizationId == null
        ? undefined
        : eq(reviews.organizationId, scope.organizationId)
    case 'connection':
      return and(
        eq(reviews.organizationId, scope.organizationId),
        eq(reviews.sourceContentState, 'active'),
        or(
          eq(reviews.googleConnectionId, scope.connectionId),
          sql<boolean>`EXISTS (
            SELECT 1 FROM ${reviewSourceContents} AS lifecycle_scope_source
            WHERE lifecycle_scope_source.review_id = ${reviews.id}
              AND lifecycle_scope_source.organization_id = ${scope.organizationId}
              AND lifecycle_scope_source.google_connection_id = ${scope.connectionId}::uuid
          )`,
        ),
      )
    case 'property':
      return and(
        eq(reviews.organizationId, scope.organizationId),
        eq(reviews.propertyId, scope.propertyId),
      )
    case 'organization':
      return eq(reviews.organizationId, scope.organizationId)
  }
}

function retentionSubject(scope: ReviewSourceContentLifecycleScope): string {
  switch (scope.kind) {
    case 'expired':
      return 'reviews.purge'
    case 'connection':
      return 'reviews.purge.connection'
    case 'property':
      return 'reviews.purge.property'
    case 'organization':
      return 'reviews.purge.organization'
  }
}

function lockedRowMatchesScope(
  row: Readonly<{
    organizationId: string
    propertyId: string
    googleConnectionId: string | null
    sourceCacheConnectionId: string | null
  }>,
  scope: ReviewSourceContentLifecycleScope,
): boolean {
  switch (scope.kind) {
    case 'expired':
      return scope.organizationId == null || row.organizationId === scope.organizationId
    case 'connection':
      return (
        row.organizationId === scope.organizationId &&
        (row.googleConnectionId === scope.connectionId ||
          row.sourceCacheConnectionId === scope.connectionId)
      )
    case 'property':
      return (
        row.organizationId === scope.organizationId && row.propertyId === scope.propertyId
      )
    case 'organization':
      return row.organizationId === scope.organizationId
  }
}

async function recordSourceExpiredFact(
  tx: Tx,
  row: Readonly<{
    id: string
    organizationId: string
    propertyId: string
    sourceEpoch: number
    sourceRevision: number
  }>,
): Promise<void> {
  const sequenceResult = await tx.execute(sql`
    SELECT lock_review_ai_analysis_head_v1(
      ${row.organizationId},
      ${row.propertyId}::uuid,
      ${row.sourceEpoch}
    ) AS analysis_sequence,
    transaction_timestamp() AS occurred_at
  `)
  const value = sequenceResult.rows[0]
  const analysisSequence = Number(value?.analysis_sequence)
  const occurredAtValue = value?.occurred_at
  const occurredAt =
    occurredAtValue instanceof Date
      ? occurredAtValue
      : new Date(String(occurredAtValue ?? ''))
  if (!Number.isSafeInteger(analysisSequence) || Number.isNaN(occurredAt.getTime())) {
    throw new Error('Review lifecycle transition controls are invalid')
  }
  const stamped = await tx
    .update(reviews)
    .set({
      analysisSequence,
      updatedAt: sql`transaction_timestamp()`,
    })
    .where(
      and(
        eq(reviews.id, row.id),
        eq(reviews.organizationId, row.organizationId),
        eq(reviews.propertyId, row.propertyId),
        eq(reviews.sourceEpoch, row.sourceEpoch),
        eq(reviews.sourceRevision, row.sourceRevision),
        eq(reviews.sourceContentState, 'source_expired'),
      ),
    )
    .returning({ id: reviews.id })
  if (!stamped[0]) {
    throw new Error('Review lifecycle transition head changed before it was stamped')
  }
  await insertOutboxRow(
    tx,
    reviewSourceTransitioned({
      reviewId: reviewId(row.id),
      organizationId: organizationId(row.organizationId),
      propertyId: propertyId(row.propertyId),
      sourceEpoch: row.sourceEpoch,
      sourceRevision: row.sourceRevision,
      analysisSequence,
      change: 'source_expired',
      occurredAt,
    }),
  )
}

/**
 * Scoped, content-free Review lifecycle inspection. All provider-value parity
 * comparisons happen in PostgreSQL; only booleans and stable Review IDs cross
 * into the application authority.
 */
export const createReviewSourceContentLifecycleStore = (
  db: Database,
): ReviewSourceContentLifecycleStore => {
  const readInspectionBatch = async (
    {
      evaluatedAt,
      after,
      limit,
      scope,
    }: Parameters<ReviewSourceContentLifecycleStore['readInspectionBatch']>[0],
    reader: Pick<Database, 'select'> = db,
    onlyReviewIds: ReadonlyArray<string> | null = null,
  ): ReturnType<ReviewSourceContentLifecycleStore['readInspectionBatch']> => {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_INSPECTION_PAGE_SIZE) {
      throw new TypeError(
        `Review lifecycle inspection limit must be between 1 and ${MAX_INSPECTION_PAGE_SIZE}`,
      )
    }
    const cursor = cursorCondition(after)

    const rows = await reader
      .select({
        reviewId: reviews.id,
        createdAt: reviews.createdAt,
        sourceContentState: reviews.sourceContentState,
        sourceCacheClock: reviewSourceContents.contentExpiresAt,
        sourceCachePresent: sql<boolean>`${reviewSourceContents.reviewId} IS NOT NULL`,
        compatibilityMatches: sql<boolean>`(
          ${reviews.organizationId} IS NOT DISTINCT FROM ${reviewSourceContents.organizationId}
          AND ${reviews.propertyId} IS NOT DISTINCT FROM ${reviewSourceContents.propertyId}
          AND ${reviews.platform} IS NOT DISTINCT FROM ${reviewSourceContents.platform}
          AND ${reviews.externalId} IS NOT DISTINCT FROM ${reviewSourceContents.externalId}
          AND ${reviews.externalLocationId} IS NOT DISTINCT FROM ${reviewSourceContents.externalLocationId}
          AND ${reviews.googleConnectionId} IS NOT DISTINCT FROM ${reviewSourceContents.googleConnectionId}
          AND ${reviews.reviewerName} IS NOT DISTINCT FROM ${reviewSourceContents.reviewerName}
          AND ${reviews.reviewerProfilePhotoUrl} IS NOT DISTINCT FROM ${reviewSourceContents.reviewerProfilePhotoUrl}
          AND ${reviews.rating} IS NOT DISTINCT FROM ${reviewSourceContents.rating}
          AND ${reviews.text} IS NOT DISTINCT FROM ${reviewSourceContents.text}
          AND ${reviews.translatedText} IS NOT DISTINCT FROM ${reviewSourceContents.translatedText}
          AND ${reviews.languageCode} IS NOT DISTINCT FROM ${reviewSourceContents.languageCode}
          AND ${reviews.reviewedAt} IS NOT DISTINCT FROM ${reviewSourceContents.reviewedAt}
          AND ${reviews.sourceCreatedAt} IS NOT DISTINCT FROM ${reviewSourceContents.sourceCreatedAt}
          AND ${reviews.sourceUpdatedAt} IS NOT DISTINCT FROM ${reviewSourceContents.sourceUpdatedAt}
          AND ${reviews.firstFetchedAt} IS NOT DISTINCT FROM ${reviewSourceContents.firstFetchedAt}
          AND ${reviews.lastFetchedAt} IS NOT DISTINCT FROM ${reviewSourceContents.lastFetchedAt}
          AND ${reviews.contentExpiresAt} IS NOT DISTINCT FROM ${reviewSourceContents.contentExpiresAt}
          AND ${reviews.contentHash} IS NOT DISTINCT FROM ${reviewSourceContents.contentHash}
          AND ${reviews.sourceEpoch} IS NOT DISTINCT FROM ${reviewSourceContents.sourceEpoch}
          AND ${reviews.sourceRevision} IS NOT DISTINCT FROM ${reviewSourceContents.sourceRevision}
          AND ${reviews.aiSourceByteLength} IS NOT DISTINCT FROM ${reviewSourceContents.aiSourceByteLength}
          AND ${reviews.aiSourceDigest} IS NOT DISTINCT FROM ${reviewSourceContents.aiSourceDigest}
        )`,
        observationPresent: sql<boolean>`${reviewSourceObservations.reviewId} IS NOT NULL`,
        observationMatches: sql<boolean>`(
          ${reviewSourceObservations.organizationId} IS NOT DISTINCT FROM ${reviews.organizationId}
          AND ${reviewSourceObservations.propertyId} IS NOT DISTINCT FROM ${reviews.propertyId}
          AND ${reviewSourceObservations.sourceEpoch} IS NOT DISTINCT FROM ${reviews.sourceEpoch}
          AND ${reviewSourceObservations.materialRevision} IS NOT DISTINCT FROM ${reviews.sourceRevision}
          AND ${reviewSourceObservations.contentExpiresAt} IS NOT DISTINCT FROM ${reviewSourceContents.contentExpiresAt}
          AND ${reviewSourceObservations.sourceCreatedAt} IS NOT DISTINCT FROM ${reviewSourceContents.sourceCreatedAt}
          AND ${reviewSourceObservations.sourceUpdatedAt} IS NOT DISTINCT FROM ${reviewSourceContents.sourceUpdatedAt}
          AND ${reviewSourceObservations.rating} IS NOT DISTINCT FROM ${reviewSourceContents.rating}
          AND ${reviewSourceObservations.originalText} IS NOT DISTINCT FROM ${reviewSourceContents.text}
          AND ${reviewSourceObservations.translatedText} IS NOT DISTINCT FROM ${reviewSourceContents.translatedText}
          AND ${reviewSourceObservations.languageCode} IS NOT DISTINCT FROM ${reviewSourceContents.languageCode}
          AND ${reviewSourceObservations.reviewerName} IS NOT DISTINCT FROM ${reviewSourceContents.reviewerName}
          AND ${reviewSourceObservations.reviewerProfilePhotoUrl} IS NOT DISTINCT FROM ${reviewSourceContents.reviewerProfilePhotoUrl}
          AND ${reviewSourceObservations.reviewedAt} IS NOT DISTINCT FROM ${reviewSourceContents.reviewedAt}
          AND ${reviewSourceObservations.contentState} = 'active'
        )`,
        materialRevisionPresent: sql<boolean>`${materialReviewRevisions.reviewId} IS NOT NULL`,
        materialRevisionMatches: sql<boolean>`(
          ${materialReviewRevisions.organizationId} IS NOT DISTINCT FROM ${reviews.organizationId}
          AND ${materialReviewRevisions.propertyId} IS NOT DISTINCT FROM ${reviews.propertyId}
          AND ${materialReviewRevisions.sourceEpoch} IS NOT DISTINCT FROM ${reviews.sourceEpoch}
          AND ${materialReviewRevisions.revision} IS NOT DISTINCT FROM ${reviews.sourceRevision}
          AND ${materialReviewRevisions.normalizationVersion} IS NOT DISTINCT FROM ${reviews.materialNormalizationVersion}
          AND ${materialReviewRevisions.sourceDigest} IS NOT DISTINCT FROM ${reviews.materialSourceDigest}
          AND ${materialReviewRevisions.normalizedDigest} IS NOT DISTINCT FROM ${reviews.materialNormalizedDigest}
          AND ${materialReviewRevisions.rating} IS NOT DISTINCT FROM ${reviewSourceContents.rating}
          AND ${materialReviewRevisions.contentState} = 'active'
        )`,
        activeGoogleSyncReplyPresent: sql<boolean>`EXISTS (
          SELECT 1 FROM ${replies} AS lifecycle_active_google_sync
          WHERE lifecycle_active_google_sync.review_id = ${reviews.id}
            AND lifecycle_active_google_sync.organization_id = ${reviews.organizationId}
            AND lifecycle_active_google_sync.source = 'google_sync'
        )`,
        activeGovernedGoogleReplyHeadPresent: sql<boolean>`EXISTS (
          SELECT 1
          FROM ${googleReplyObservationHeads} AS lifecycle_google_reply_head
          INNER JOIN ${googleReplyObservations} AS lifecycle_current_google_reply
            ON lifecycle_current_google_reply.id = lifecycle_google_reply_head.observation_id
           AND lifecycle_current_google_reply.organization_id = lifecycle_google_reply_head.organization_id
           AND lifecycle_current_google_reply.property_id = lifecycle_google_reply_head.property_id
           AND lifecycle_current_google_reply.review_id = lifecycle_google_reply_head.review_id
          WHERE lifecycle_google_reply_head.review_id = ${reviews.id}
            AND lifecycle_google_reply_head.organization_id = ${reviews.organizationId}
            AND lifecycle_google_reply_head.property_id = ${reviews.propertyId}
            AND lifecycle_google_reply_head.source_epoch = ${reviews.sourceEpoch}
            AND lifecycle_google_reply_head.material_review_revision = ${reviews.sourceRevision}
            AND lifecycle_current_google_reply.content_state = 'active'
        )`,
        tombstoneCompatibilityContentPresent: sql<boolean>`(
          ${reviews.externalId} IS NOT NULL
          OR ${reviews.externalLocationId} IS NOT NULL
          OR ${reviews.googleConnectionId} IS NOT NULL
          OR ${reviews.reviewerName} IS NOT NULL
          OR ${reviews.reviewerProfilePhotoUrl} IS NOT NULL
          OR ${reviews.rating} IS NOT NULL
          OR ${reviews.text} IS NOT NULL
          OR ${reviews.translatedText} IS NOT NULL
          OR ${reviews.languageCode} IS NOT NULL
          OR ${reviews.reviewedAt} IS NOT NULL
          OR ${reviews.sourceCreatedAt} IS NOT NULL
          OR ${reviews.sourceUpdatedAt} IS NOT NULL
          OR ${reviews.contentHash} IS NOT NULL
          OR ${reviews.aiSourceByteLength} IS NOT NULL
          OR ${reviews.aiSourceDigest} IS NOT NULL
        )`,
        tombstoneObservationContentPresent: sql<boolean>`EXISTS (
          SELECT 1 FROM ${reviewSourceObservations} AS lifecycle_observation
          WHERE lifecycle_observation.review_id = ${reviews.id}
            AND lifecycle_observation.content_state = 'active'
        )`,
        tombstoneMaterialContentPresent: sql<boolean>`EXISTS (
          SELECT 1 FROM ${materialReviewRevisions} AS lifecycle_material
          WHERE lifecycle_material.review_id = ${reviews.id}
            AND lifecycle_material.content_state = 'active'
        )`,
        tombstoneGoogleReplyContentPresent: sql<boolean>`EXISTS (
          SELECT 1 FROM ${googleReplyObservations} AS lifecycle_google_reply
          WHERE lifecycle_google_reply.review_id = ${reviews.id}
            AND lifecycle_google_reply.content_state = 'active'
            AND (
              lifecycle_google_reply.normalized_text IS NOT NULL
              OR lifecycle_google_reply.normalized_digest IS NOT NULL
            )
        )`,
        tombstoneGoogleSyncReplyPresent: sql<boolean>`EXISTS (
          SELECT 1 FROM ${replies} AS lifecycle_google_sync
          WHERE lifecycle_google_sync.review_id = ${reviews.id}
            AND lifecycle_google_sync.organization_id = ${reviews.organizationId}
            AND lifecycle_google_sync.source = 'google_sync'
        )`,
      })
      .from(reviews)
      .leftJoin(reviewSourceContents, eq(reviewSourceContents.reviewId, reviews.id))
      .leftJoin(
        reviewSourceObservations,
        and(
          eq(reviewSourceObservations.reviewId, reviews.id),
          eq(
            reviewSourceObservations.observationSequence,
            reviews.sourceObservationSequence,
          ),
        ),
      )
      .leftJoin(
        materialReviewRevisions,
        and(
          eq(materialReviewRevisions.reviewId, reviews.id),
          eq(materialReviewRevisions.revision, reviews.sourceRevision),
        ),
      )
      .where(
        and(
          lte(reviews.createdAt, evaluatedAt),
          cursor,
          lifecycleScopeCondition(scope),
          onlyReviewIds == null ? undefined : inArray(reviews.id, onlyReviewIds),
        ),
      )
      .orderBy(asc(reviews.createdAt), asc(reviews.id))
      .limit(limit)

    return rows.map((row) => toInspection(row))
  }

  return {
    readInspectionBatch: (input) => readInspectionBatch(input),
    applyLifecycleBatch: async ({
      evaluatedAt,
      after,
      limit,
      scope,
      recoveryExecution,
    }) => {
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_APPLY_PAGE_SIZE) {
        throw new TypeError(
          `Review lifecycle apply limit must be between 1 and ${MAX_APPLY_PAGE_SIZE}`,
        )
      }
      if (!Number.isFinite(evaluatedAt.getTime())) {
        throw new TypeError('Review lifecycle apply timestamp is invalid')
      }

      return db.transaction(async (tx) => {
        if (recoveryExecution != null) {
          const execution = await tx
            .select({
              state: reviewLifecycleRecoveryExecutions.state,
              checkpointCreatedAt: reviewLifecycleRecoveryExecutions.checkpointCreatedAt,
              checkpointReviewId: reviewLifecycleRecoveryExecutions.checkpointReviewId,
            })
            .from(reviewLifecycleRecoveryExecutions)
            .where(
              and(
                eq(reviewLifecycleRecoveryExecutions.id, recoveryExecution.recoveryRunId),
                eq(
                  reviewLifecycleRecoveryExecutions.recoveryGeneration,
                  recoveryExecution.recoveryGeneration,
                ),
                eq(
                  reviewLifecycleRecoveryExecutions.approvalId,
                  recoveryExecution.approvalId,
                ),
                eq(
                  reviewLifecycleRecoveryExecutions.approvalBundleSha256,
                  recoveryExecution.approvalBundleSha256,
                ),
              ),
            )
            .for('update')
            .limit(1)
          const receipt = execution[0]
          const checkpointMatches =
            receipt != null &&
            ((after == null &&
              receipt.checkpointCreatedAt == null &&
              receipt.checkpointReviewId == null) ||
              (after != null &&
                receipt.checkpointCreatedAt != null &&
                receipt.checkpointReviewId === after.reviewId &&
                receipt.checkpointCreatedAt.getTime() === after.createdAt.getTime()))
          if (receipt?.state !== 'applying' || !checkpointMatches) {
            throw new Error(
              'Review lifecycle recovery receipt is missing, stale, or already advanced',
            )
          }
        }

        const clockResult = await tx.execute(
          sql`SELECT transaction_timestamp() AS database_now`,
        )
        const clockValue = clockResult.rows[0]?.database_now
        const databaseNow =
          clockValue instanceof Date ? clockValue : new Date(String(clockValue ?? ''))
        if (Number.isNaN(databaseNow.getTime())) {
          throw new Error('Review lifecycle database clock is invalid')
        }
        if (evaluatedAt > databaseNow) {
          throw new Error('Review lifecycle apply window is ahead of the database clock')
        }
        const effectiveEvaluatedAt = evaluatedAt

        // Discovery is non-locking; every discovered Property and Review is
        // then locked in one deterministic order and scope is rechecked. New
        // Reviews cannot enter the frozen createdAt window after this point.
        const discovered = await tx
          .select({
            id: reviews.id,
            organizationId: reviews.organizationId,
            propertyId: reviews.propertyId,
            createdAt: reviews.createdAt,
          })
          .from(reviews)
          .where(
            and(
              lte(reviews.createdAt, effectiveEvaluatedAt),
              cursorCondition(after),
              lifecycleScopeCondition(scope),
            ),
          )
          .orderBy(asc(reviews.createdAt), asc(reviews.id))
          .limit(limit + 1)
        const hasMore = discovered.length > limit
        const page = discovered.slice(0, limit)
        const pageIds = page.map((row) => row.id)

        const propertyIds = [...new Set(page.map((row) => row.propertyId))].sort()
        const lockedProperties =
          propertyIds.length === 0
            ? []
            : await tx
                .select({
                  id: properties.id,
                  organizationId: properties.organizationId,
                  sourceEpoch: properties.sourceEpoch,
                })
                .from(properties)
                .where(inArray(properties.id, propertyIds))
                .orderBy(asc(properties.id))
                .for('update')
        const propertyEpochs = new Map(
          lockedProperties.map((row) => [
            `${row.organizationId}\0${row.id}`,
            row.sourceEpoch,
          ]),
        )

        const replyTruthLockOrder = [...page].sort((left, right) =>
          left.organizationId === right.organizationId
            ? left.id.localeCompare(right.id)
            : left.organizationId.localeCompare(right.organizationId),
        )
        for (const candidate of replyTruthLockOrder) {
          await lockReplyTruthScope(
            tx,
            organizationId(candidate.organizationId),
            reviewId(candidate.id),
          )
        }

        const lockedRows =
          pageIds.length === 0
            ? []
            : await tx
                .select({
                  id: reviews.id,
                  organizationId: reviews.organizationId,
                  propertyId: reviews.propertyId,
                  googleConnectionId: reviews.googleConnectionId,
                  sourceCacheConnectionId: reviewSourceContents.googleConnectionId,
                  sourceEpoch: reviews.sourceEpoch,
                  sourceRevision: reviews.sourceRevision,
                  sourceContentState: reviews.sourceContentState,
                })
                .from(reviews)
                .leftJoin(
                  reviewSourceContents,
                  eq(reviewSourceContents.reviewId, reviews.id),
                )
                .where(inArray(reviews.id, pageIds))
                .orderBy(asc(reviews.id))
                .for('update', { of: reviews })
        const lockedById = new Map(lockedRows.map((row) => [row.id, row]))
        if (lockedById.size !== pageIds.length) {
          throw new Error('Review lifecycle page changed during lock acquisition')
        }

        const inspections = await readInspectionBatch(
          {
            evaluatedAt: effectiveEvaluatedAt,
            after,
            limit,
            scope,
          },
          tx,
          pageIds,
        )
        const inspectionById = new Map(
          inspections.map((inspection) => [inspection.reviewId, inspection]),
        )
        if (inspectionById.size !== pageIds.length) {
          throw new Error('Review lifecycle page inspection is incomplete')
        }

        let rowsRedacted = 0
        let legacyGoogleRepliesReconciled = 0
        for (const candidate of page) {
          const row = lockedById.get(candidate.id)!
          const inspection = inspectionById.get(reviewId(candidate.id))!
          if (!lockedRowMatchesScope(row, scope)) continue

          const shouldExpire =
            row.sourceContentState === 'active' &&
            (scope.kind !== 'expired' ||
              (inspection.lifecycleClock != null &&
                inspection.lifecycleClock <= effectiveEvaluatedAt))
          const shouldRepairTombstone =
            row.sourceContentState !== 'active' && inspection.shadowFindings.length > 0

          if (shouldExpire || shouldRepairTombstone) {
            const erased = await eraseReviewSourceContent(tx, {
              reviewId: reviewId(row.id),
              organizationId: organizationId(row.organizationId),
              propertyId: propertyId(row.propertyId),
              sourceEpoch: row.sourceEpoch,
              expectedSourceRevision: row.sourceRevision,
              state:
                row.sourceContentState === 'provider_deleted'
                  ? 'provider_deleted'
                  : 'source_expired',
            })
            if (!erased) {
              throw new Error('Review changed during lifecycle batch apply')
            }
            rowsRedacted += 1

            if (shouldExpire) {
              await tx
                .update(reviewProviderSubjects)
                .set({
                  state: 'source_expired',
                  unlinkedAt: sql`transaction_timestamp()`,
                  unlinkExpiresAt: sql`transaction_timestamp() + interval '2 years'`,
                  updatedAt: sql`transaction_timestamp()`,
                })
                .where(
                  and(
                    eq(reviewProviderSubjects.organizationId, row.organizationId),
                    eq(reviewProviderSubjects.propertyId, row.propertyId),
                    eq(reviewProviderSubjects.sourceEpoch, row.sourceEpoch),
                    eq(reviewProviderSubjects.reviewId, row.id),
                    eq(reviewProviderSubjects.state, 'linked'),
                  ),
                )
              if (
                propertyEpochs.get(`${row.organizationId}\0${row.propertyId}`) ===
                row.sourceEpoch
              ) {
                await recordSourceExpiredFact(tx, row)
              }
            }
            continue
          }

          if (
            row.sourceContentState === 'active' &&
            inspection.shadowFindings.includes('active_google_sync_reply_redundant')
          ) {
            const reconciled = await tx
              .delete(replies)
              .where(
                and(
                  eq(replies.organizationId, row.organizationId),
                  eq(replies.reviewId, row.id),
                  eq(replies.source, 'google_sync'),
                ),
              )
              .returning({ id: replies.id })
            legacyGoogleRepliesReconciled += reconciled.length
            if (reconciled.length > 0) rowsRedacted += 1
          }
        }

        await tx.insert(retentionRuns).values({
          subject: retentionSubject(scope),
          startedAt: sql`transaction_timestamp()`,
          finishedAt: sql`transaction_timestamp()`,
          batchSize: limit,
          batches: page.length === 0 ? 0 : 1,
          rowsDeleted: 0,
          rowsRedacted,
          outcome: 'completed',
          errorCode: null,
          policyVersion: REVIEW_SOURCE_CONTENT_LIFECYCLE_RETENTION_POLICY_VERSION,
        })

        if (recoveryExecution != null) {
          const last = inspections.at(-1)
          if (hasMore && last == null) {
            throw new Error('Review lifecycle recovery checkpoint did not advance')
          }
          const updated = await tx
            .update(reviewLifecycleRecoveryExecutions)
            .set({
              state: hasMore ? 'applying' : 'lifecycle_applied',
              checkpointCreatedAt: hasMore ? last!.createdAt : null,
              checkpointReviewId: hasMore ? last!.reviewId : null,
              pages: sql`${reviewLifecycleRecoveryExecutions.pages} + ${page.length === 0 ? 0 : 1}`,
              scanned: sql`${reviewLifecycleRecoveryExecutions.scanned} + ${inspections.length}`,
              rowsRedacted: sql`${reviewLifecycleRecoveryExecutions.rowsRedacted} + ${rowsRedacted}`,
              legacyGoogleRepliesReconciled: sql`${reviewLifecycleRecoveryExecutions.legacyGoogleRepliesReconciled} + ${legacyGoogleRepliesReconciled}`,
              errorCode: null,
              updatedAt: sql`clock_timestamp()`,
            })
            .where(
              and(
                eq(reviewLifecycleRecoveryExecutions.id, recoveryExecution.recoveryRunId),
                eq(
                  reviewLifecycleRecoveryExecutions.recoveryGeneration,
                  recoveryExecution.recoveryGeneration,
                ),
                eq(
                  reviewLifecycleRecoveryExecutions.approvalId,
                  recoveryExecution.approvalId,
                ),
                eq(
                  reviewLifecycleRecoveryExecutions.approvalBundleSha256,
                  recoveryExecution.approvalBundleSha256,
                ),
                eq(reviewLifecycleRecoveryExecutions.state, 'applying'),
              ),
            )
            .returning({ id: reviewLifecycleRecoveryExecutions.id })
          if (!updated[0]) {
            throw new Error('Review lifecycle recovery receipt changed during apply')
          }
        }

        return {
          rows: inspections,
          hasMore,
          rowsRedacted,
          legacyGoogleRepliesReconciled,
        }
      })
    },
  }
}
