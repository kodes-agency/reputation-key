import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  materialReviewRevisions,
  reviews,
  reviewSourceObservations,
} from '#/shared/db/schema/review.schema'
import {
  organizationId,
  propertyId,
  reviewId,
  type OrganizationId,
  type ReviewId,
} from '#/shared/domain/ids'
import { sha256Hex } from '#/shared/domain/sha256'
import type { Tx } from '#/shared/outbox/commit'
import type {
  MaterialReviewRevision,
  ReviewObservationComparison,
  ReviewObservationRepository,
  ReviewSourceObservation,
} from '../../application/ports/review-observation.repository'
import {
  compareMaterialReviewRevision,
  computeReviewSourceObservationDigest,
  REVIEW_MATERIAL_NORMALIZATION_VERSION,
  type ReviewMaterialComparison,
} from '../../domain/material-review-revision'
import { reviewError } from '../../domain/errors'
import type { Review, StarRating } from '../../domain/types'
import { reviewFromRow, reviewToRow } from '../mappers/review.mapper'
import { upsertReviewSourceContent } from '../review-source-content-store'

const HEX_DIGEST = /^[0-9a-f]{64}$/u

type ReviewRow = typeof reviews.$inferSelect

export type PersistedReviewObservation = Readonly<{
  review: Review
  observationSequence: number
  materialRevision: number
  comparison: ReviewObservationComparison
  createsMaterialRevision: boolean
  duplicate: boolean
  outOfOrder: boolean
}>

function providerVersion(
  row: Readonly<{
    sourceUpdatedAt: Date | null
    sourceCreatedAt: Date | null
    reviewedAt: Date | null
  }>,
): Date | null {
  return row.sourceUpdatedAt ?? row.sourceCreatedAt ?? row.reviewedAt
}

function fallbackObservationKey(observationDigest: string, observedAt: Date): string {
  return sha256Hex(
    `repkey-review-observation-command-v1\0${observationDigest}\0${observedAt.toISOString()}`,
  )
}

function currentMaterial(row: ReviewRow) {
  return {
    materialRevision: Math.max(1, row.sourceRevision),
    normalizationVersion: row.materialNormalizationVersion ?? 'legacy-unverified-v0',
    sourceDigest: row.materialSourceDigest,
    normalizedDigest: row.materialNormalizedDigest,
    rating: row.rating as StarRating | null,
    originalText: row.text,
  }
}

function sourceObservationValues(
  input: Readonly<{
    review: Omit<Review, 'createdAt' | 'updatedAt'>
    observationSequence: number
    materialRevision: number
    observationKey: string
    observationDigest: string
    comparison: ReviewObservationComparison
    sourceDigest: string
    normalizedDigest: string
    observedAt: Date
  }>,
) {
  return {
    reviewId: input.review.id,
    observationSequence: input.observationSequence,
    organizationId: input.review.organizationId,
    propertyId: input.review.propertyId,
    sourceEpoch: input.review.sourceEpoch,
    observationKey: input.observationKey,
    observationDigest: input.observationDigest,
    materialRevision: input.materialRevision,
    observedAt: input.observedAt,
    contentExpiresAt: input.review.contentExpiresAt!,
    sourceCreatedAt: input.review.sourceCreatedAt,
    sourceUpdatedAt: input.review.sourceUpdatedAt,
    sourceDigest: input.sourceDigest,
    normalizationVersion: REVIEW_MATERIAL_NORMALIZATION_VERSION,
    normalizedDigest: input.normalizedDigest,
    comparisonResult: input.comparison,
    rating: input.review.rating,
    originalText: input.review.text,
    translatedText: input.review.translatedText,
    languageCode: input.review.languageCode,
    reviewerName: input.review.reviewerName,
    reviewerProfilePhotoUrl: input.review.reviewerProfilePhotoUrl,
    reviewedAt: input.review.reviewedAt,
    contentState: 'active' as const,
    contentErasedAt: null,
  }
}

async function insertOrRestoreMaterialRevision(
  tx: Tx,
  input: Readonly<{
    review: Omit<Review, 'createdAt' | 'updatedAt'>
    materialRevision: number
    comparison: ReviewMaterialComparison
    createsMaterialRevision: boolean
    sourceDigest: string
    normalizedDigest: string
    normalizedText: string | null
    observedAt: Date
  }>,
): Promise<void> {
  const values = {
    reviewId: input.review.id,
    revision: input.materialRevision,
    organizationId: input.review.organizationId,
    propertyId: input.review.propertyId,
    sourceEpoch: input.review.sourceEpoch,
    normalizationVersion: REVIEW_MATERIAL_NORMALIZATION_VERSION,
    sourceDigest: input.sourceDigest,
    normalizedDigest: input.normalizedDigest,
    rating: input.review.rating,
    normalizedText: input.normalizedText,
    contentState: 'active' as const,
    contentErasedAt: null,
    createdAt: input.observedAt,
    updatedAt: input.observedAt,
  }
  if (input.createsMaterialRevision) {
    await tx.insert(materialReviewRevisions).values(values)
    return
  }

  const adoptComparisonBaseline =
    input.comparison === 'normalization_shadow_match' ||
    input.comparison === 'baseline_unavailable'
  const rows = await tx
    .update(materialReviewRevisions)
    .set({
      ...(adoptComparisonBaseline
        ? {
            normalizationVersion: values.normalizationVersion,
            sourceDigest: values.sourceDigest,
            normalizedDigest: values.normalizedDigest,
          }
        : {}),
      rating: values.rating,
      normalizedText: values.normalizedText,
      contentState: 'active',
      contentErasedAt: null,
      updatedAt: input.observedAt,
    })
    .where(
      and(
        eq(materialReviewRevisions.reviewId, input.review.id),
        eq(materialReviewRevisions.revision, input.materialRevision),
      ),
    )
    .returning({ revision: materialReviewRevisions.revision })
  if (!rows[0]) {
    throw reviewError('repo_upsert_failed', 'Current Material Review Revision is missing')
  }
}

/**
 * Canonical REV-01 write adapter. The caller supplies a transaction so Review,
 * current source content, the observation/revision records, and any outbox fact
 * commit as one unit.
 */
export async function persistReviewObservation(
  tx: Tx,
  input: Readonly<{
    review: Omit<Review, 'createdAt' | 'updatedAt'>
    observedAt: Date
    observationKey?: string
  }>,
): Promise<PersistedReviewObservation> {
  if (input.review.lastFetchedAt == null || input.review.contentExpiresAt == null) {
    throw reviewError(
      'repo_upsert_failed',
      'Provider Review observation requires a fetch-based expiry',
    )
  }
  const observationDigest = computeReviewSourceObservationDigest({
    rating: input.review.rating,
    text: input.review.text,
    translatedText: input.review.translatedText,
    languageCode: input.review.languageCode,
    reviewerName: input.review.reviewerName,
    reviewerProfilePhotoUrl: input.review.reviewerProfilePhotoUrl,
    reviewedAt: input.review.reviewedAt,
    sourceCreatedAt: input.review.sourceCreatedAt,
    sourceUpdatedAt: input.review.sourceUpdatedAt,
  })
  const observationKey =
    input.observationKey ?? fallbackObservationKey(observationDigest, input.observedAt)
  if (!HEX_DIGEST.test(observationKey)) {
    throw new TypeError('Review observation key must be a lowercase SHA-256 digest')
  }

  const identityRows = await tx
    .select()
    .from(reviews)
    .where(eq(reviews.id, input.review.id))
    .for('update')
  const existing = identityRows[0] ?? null
  if (
    existing != null &&
    (existing.organizationId !== input.review.organizationId ||
      existing.propertyId !== input.review.propertyId ||
      existing.platform !== input.review.platform ||
      existing.sourceEpoch !== input.review.sourceEpoch)
  ) {
    throw reviewError('repo_upsert_failed', 'Review stable identity scope collision')
  }

  const externalRows = await tx
    .select({
      id: reviews.id,
      propertyId: reviews.propertyId,
      sourceEpoch: reviews.sourceEpoch,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.organizationId, input.review.organizationId),
        eq(reviews.platform, input.review.platform),
        eq(reviews.externalId, input.review.externalId),
      ),
    )
    .for('update')
  const external = externalRows[0]
  if (
    external != null &&
    (external.id !== input.review.id ||
      external.propertyId !== input.review.propertyId ||
      external.sourceEpoch !== input.review.sourceEpoch)
  ) {
    throw reviewError('repo_upsert_failed', 'Review provider identity scope collision')
  }

  if (existing != null) {
    const duplicates = await tx
      .select({
        observationSequence: reviewSourceObservations.observationSequence,
        materialRevision: reviewSourceObservations.materialRevision,
        comparisonResult: reviewSourceObservations.comparisonResult,
        observationDigest: reviewSourceObservations.observationDigest,
      })
      .from(reviewSourceObservations)
      .where(
        and(
          eq(reviewSourceObservations.reviewId, input.review.id),
          eq(reviewSourceObservations.sourceEpoch, input.review.sourceEpoch),
          eq(reviewSourceObservations.observationKey, observationKey),
        ),
      )
      .limit(1)
    if (duplicates[0]) {
      if (duplicates[0].observationDigest !== observationDigest) {
        throw reviewError('repo_upsert_failed', 'Review observation key collision')
      }
      if (existing.sourceContentState !== 'active') {
        throw reviewError(
          'repo_upsert_failed',
          'An erased Review cannot be restored from a replayed observation',
        )
      }
      return {
        review: reviewFromRow(existing),
        observationSequence: duplicates[0].observationSequence,
        materialRevision: duplicates[0].materialRevision,
        comparison: duplicates[0].comparisonResult as ReviewObservationComparison,
        createsMaterialRevision: false,
        duplicate: true,
        outOfOrder: false,
      }
    }
  }

  const material = compareMaterialReviewRevision({
    // A compatibility row written after the expand migration has no explicit
    // comparison baseline. Its first governed observation becomes revision 1;
    // only migration-backed `legacy-unverified-v0` rows enter shadow compare.
    previous:
      existing == null || existing.materialNormalizationVersion == null
        ? null
        : currentMaterial(existing),
    incoming: { rating: input.review.rating, text: input.review.text },
  })
  const observationSequence = (existing?.sourceObservationSequence ?? 0) + 1
  if (!Number.isSafeInteger(observationSequence) || observationSequence <= 0) {
    throw reviewError('repo_upsert_failed', 'Review observation sequence overflow')
  }

  const incomingProviderVersion = providerVersion(input.review)
  const currentProviderVersion = existing == null ? null : providerVersion(existing)
  const outOfOrder =
    existing != null &&
    incomingProviderVersion != null &&
    currentProviderVersion != null &&
    incomingProviderVersion.getTime() < currentProviderVersion.getTime()
  if (outOfOrder) {
    await tx.insert(reviewSourceObservations).values(
      sourceObservationValues({
        review: input.review,
        observationSequence,
        materialRevision: Math.max(1, existing.sourceRevision),
        observationKey,
        observationDigest,
        comparison: 'out_of_order_ignored',
        sourceDigest: material.sourceDigest,
        normalizedDigest: material.normalizedDigest,
        observedAt: input.observedAt,
      }),
    )
    await tx
      .update(reviews)
      .set({
        sourceObservationSequence: observationSequence,
        updatedAt: input.observedAt,
      })
      .where(eq(reviews.id, existing.id))
    return {
      review: reviewFromRow(existing),
      observationSequence,
      materialRevision: Math.max(1, existing.sourceRevision),
      comparison: 'out_of_order_ignored',
      createsMaterialRevision: false,
      duplicate: false,
      outOfOrder: true,
    }
  }

  const observedReview = {
    ...input.review,
    sourceRevision: material.materialRevision,
  }
  const row = reviewToRow(observedReview)
  let persistedRows: ReviewRow[]
  if (existing == null) {
    persistedRows = await tx
      .insert(reviews)
      .values({
        ...row,
        sourceObservationSequence: observationSequence,
        materialNormalizationVersion: material.normalizationVersion,
        materialSourceDigest: material.sourceDigest,
        materialNormalizedDigest: material.normalizedDigest,
        createdAt: input.observedAt,
        updatedAt: input.observedAt,
      })
      .returning()
  } else {
    persistedRows = await tx
      .update(reviews)
      .set({
        propertyId: row.propertyId,
        externalId: row.externalId,
        externalLocationId: row.externalLocationId,
        googleConnectionId: row.googleConnectionId,
        reviewerName: row.reviewerName,
        reviewerProfilePhotoUrl: row.reviewerProfilePhotoUrl,
        rating: row.rating,
        text: row.text,
        translatedText: row.translatedText,
        languageCode: row.languageCode,
        reviewedAt: row.reviewedAt,
        expiresAt: row.expiresAt,
        sentimentLabel: row.sentimentLabel,
        sentimentScore: row.sentimentScore,
        sourceCreatedAt: row.sourceCreatedAt,
        sourceUpdatedAt: row.sourceUpdatedAt,
        firstFetchedAt: row.firstFetchedAt,
        lastFetchedAt: row.lastFetchedAt,
        contentExpiresAt: row.contentExpiresAt,
        contentHash: row.contentHash,
        sourceSeenGeneration: row.sourceSeenGeneration,
        sourceRevision: material.materialRevision,
        sourceObservationSequence: observationSequence,
        materialNormalizationVersion: material.normalizationVersion,
        materialSourceDigest: material.sourceDigest,
        materialNormalizedDigest: material.normalizedDigest,
        analysisSequence: row.analysisSequence,
        aiSourceByteLength: row.aiSourceByteLength,
        aiSourceDigest: row.aiSourceDigest,
        sourceContentState: 'active',
        sourceContentErasedAt: null,
        updatedAt: input.observedAt,
      })
      .where(
        and(
          eq(reviews.id, existing.id),
          eq(reviews.organizationId, existing.organizationId),
          eq(reviews.propertyId, existing.propertyId),
          eq(reviews.sourceEpoch, existing.sourceEpoch),
        ),
      )
      .returning()
  }
  const persistedRow = persistedRows[0]
  if (!persistedRow) {
    throw reviewError('repo_upsert_failed', 'Review observation returned no row')
  }

  await insertOrRestoreMaterialRevision(tx, {
    review: observedReview,
    materialRevision: material.materialRevision,
    comparison: material.comparison,
    createsMaterialRevision: material.createsMaterialRevision,
    sourceDigest: material.sourceDigest,
    normalizedDigest: material.normalizedDigest,
    normalizedText: material.normalizedText,
    observedAt: input.observedAt,
  })
  await tx.insert(reviewSourceObservations).values(
    sourceObservationValues({
      review: observedReview,
      observationSequence,
      materialRevision: material.materialRevision,
      observationKey,
      observationDigest,
      comparison: material.comparison,
      sourceDigest: material.sourceDigest,
      normalizedDigest: material.normalizedDigest,
      observedAt: input.observedAt,
    }),
  )
  if (!(await upsertReviewSourceContent(tx, observedReview))) {
    throw reviewError(
      'repo_upsert_failed',
      'Provider Review observation requires a fetch-based expiry',
    )
  }

  return {
    review: reviewFromRow(persistedRow),
    observationSequence,
    materialRevision: material.materialRevision,
    comparison: material.comparison,
    createsMaterialRevision: material.createsMaterialRevision,
    duplicate: false,
    outOfOrder: false,
  }
}

function mapObservation(
  row: typeof reviewSourceObservations.$inferSelect,
): ReviewSourceObservation {
  return {
    reviewId: reviewId(row.reviewId),
    organizationId: organizationId(row.organizationId),
    propertyId: propertyId(row.propertyId),
    sourceEpoch: row.sourceEpoch,
    observationSequence: row.observationSequence,
    materialRevision: row.materialRevision,
    observedAt: row.observedAt,
    contentExpiresAt: row.contentExpiresAt,
    sourceDigest: row.sourceDigest,
    normalizationVersion: row.normalizationVersion,
    normalizedDigest: row.normalizedDigest,
    comparison: row.comparisonResult as ReviewObservationComparison,
    rating: row.rating as StarRating | null,
    originalText: row.originalText,
    contentState: row.contentState as ReviewSourceObservation['contentState'],
    contentErasedAt: row.contentErasedAt,
  }
}

function mapMaterialRevision(
  row: typeof materialReviewRevisions.$inferSelect,
): MaterialReviewRevision {
  return {
    reviewId: reviewId(row.reviewId),
    organizationId: organizationId(row.organizationId),
    propertyId: propertyId(row.propertyId),
    sourceEpoch: row.sourceEpoch,
    revision: row.revision,
    normalizationVersion: row.normalizationVersion,
    sourceDigest: row.sourceDigest,
    normalizedDigest: row.normalizedDigest,
    rating: row.rating as StarRating | null,
    normalizedText: row.normalizedText,
    contentState: row.contentState as MaterialReviewRevision['contentState'],
    contentErasedAt: row.contentErasedAt,
    createdAt: row.createdAt,
  }
}

export function createReviewObservationRepository(
  db: Database,
): ReviewObservationRepository {
  return Object.freeze({
    findObservations: async (id: ReviewId, orgId: OrganizationId) => {
      const rows = await db
        .select()
        .from(reviewSourceObservations)
        .where(
          and(
            eq(reviewSourceObservations.reviewId, id),
            eq(reviewSourceObservations.organizationId, orgId),
          ),
        )
        .orderBy(asc(reviewSourceObservations.observationSequence))
      return rows.map(mapObservation)
    },
    findMaterialRevisions: async (id: ReviewId, orgId: OrganizationId) => {
      const rows = await db
        .select()
        .from(materialReviewRevisions)
        .where(
          and(
            eq(materialReviewRevisions.reviewId, id),
            eq(materialReviewRevisions.organizationId, orgId),
          ),
        )
        .orderBy(asc(materialReviewRevisions.revision))
      return rows.map(mapMaterialRevision)
    },
  })
}
