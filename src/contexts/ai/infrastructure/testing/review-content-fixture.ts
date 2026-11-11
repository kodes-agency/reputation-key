import { getDb } from '#/shared/db'
import { reviews, reviewSourceContents } from '#/shared/db/schema'

type ContentInsert = typeof reviewSourceContents.$inferInsert

type ReviewSeed = typeof reviews.$inferInsert &
  Partial<
    Pick<
      ContentInsert,
      | 'reviewerName'
      | 'reviewerProfilePhotoUrl'
      | 'googleReviewUrl'
      | 'text'
      | 'translatedText'
      | 'languageCode'
      | 'sourceCreatedAt'
      | 'sourceUpdatedAt'
      | 'lastFetchedAt'
      | 'contentHash'
      | 'aiSourceByteLength'
      | 'aiSourceDigest'
    >
  > & {
    id: string
    externalId: string
    rating: number
    reviewedAt: Date
    contentExpiresAt: Date
  }

/** A stable Review and its provider row, without a second provider copy. */
export async function seedReviewContent(input: ReviewSeed | ReviewSeed[]): Promise<void> {
  const rows = Array.isArray(input) ? input : [input]
  const db = getDb()
  await db.insert(reviews).values(
    rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      propertyId: row.propertyId,
      platform: row.platform,
      googleConnectionId: row.googleConnectionId,
      firstFetchedAt: row.firstFetchedAt ?? row.reviewedAt,
      sourceEpoch: row.sourceEpoch,
      sourceRevision: row.sourceRevision,
      analysisSequence: row.analysisSequence,
    })),
  )
  await db.insert(reviewSourceContents).values(
    rows.map((row) => ({
      reviewId: row.id,
      organizationId: row.organizationId,
      propertyId: row.propertyId,
      platform: row.platform,
      externalId: row.externalId,
      externalLocationId: row.externalLocationId ?? 'locations/ai-review-fixture',
      googleConnectionId: row.googleConnectionId,
      reviewerName: row.reviewerName,
      reviewerProfilePhotoUrl: row.reviewerProfilePhotoUrl,
      googleReviewUrl: row.googleReviewUrl,
      rating: row.rating,
      text: row.text,
      translatedText: row.translatedText,
      languageCode: row.languageCode,
      reviewedAt: row.reviewedAt,
      sourceCreatedAt: row.sourceCreatedAt,
      sourceUpdatedAt: row.sourceUpdatedAt,
      firstFetchedAt: row.firstFetchedAt ?? row.reviewedAt,
      lastFetchedAt: row.lastFetchedAt ?? row.reviewedAt,
      contentExpiresAt: row.contentExpiresAt,
      contentHash: row.contentHash,
      sourceEpoch: row.sourceEpoch,
      sourceRevision: row.sourceRevision,
      aiSourceByteLength: row.aiSourceByteLength ?? 24,
      aiSourceDigest: row.aiSourceDigest ?? 'a'.repeat(64),
    })),
  )
}
