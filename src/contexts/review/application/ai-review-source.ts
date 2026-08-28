import { createHash } from 'node:crypto'
import {
  AI_REVIEW_SOURCE_CONTRACT_VERSION,
  canonicalizeRawAiReviewSource,
} from '#/shared/ai-review-source-contract'
import type { StarRating } from '../domain/types'
import type { ReviewRepository } from './ports/review.repository'
import type { AiReviewSourcePort } from './ports/ai-review-source.port'

const DIGEST_PREFIX = new TextEncoder().encode(`${AI_REVIEW_SOURCE_CONTRACT_VERSION}\0`)

export type AiReviewSourceProvenance = Readonly<{
  text: string | null
  rating: StarRating
  languageCode: string | null
  reviewedAtEpochMillis: number
  byteLength: number
  digest: string
}>

/**
 * The sole Review-side raw canonicalization integration. It delegates every
 * normalization and identity-minimization rule to the shared contract.
 */
export function computeAiReviewSourceProvenance(
  input: Readonly<{
    text: string | null
    rating: StarRating
    languageCode: string | null
    reviewedAtEpochMillis: number
    reviewerDisplayName: string | null
  }>,
): AiReviewSourceProvenance {
  const canonical = canonicalizeRawAiReviewSource(input)
  const digest = createHash('sha256')
    .update(DIGEST_PREFIX)
    .update(canonical.bytes)
    .digest('hex')
  return Object.freeze({
    text: canonical.text,
    rating: canonical.rating as StarRating,
    languageCode: canonical.languageCode,
    reviewedAtEpochMillis: canonical.reviewedAtEpochMillis,
    byteLength: canonical.bytes.byteLength,
    digest,
  })
}

export type AiReviewSourceDependencies = Readonly<{
  findById(
    reviewId: Parameters<ReviewRepository['findById']>[0],
    organizationId: Parameters<ReviewRepository['findById']>[1],
  ): Promise<Pick<
    NonNullable<Awaited<ReturnType<ReviewRepository['findById']>>>,
    | 'id'
    | 'organizationId'
    | 'propertyId'
    | 'sourceEpoch'
    | 'sourceRevision'
    | 'analysisSequence'
  > | null>
  readForAi: ReviewRepository['readForAi']
  readTrendPopulation: ReviewRepository['readTrendPopulation']
  assertCurrentForAi: ReviewRepository['assertCurrentForAi']
  readReplyStateRevision(
    organizationId: Parameters<ReviewRepository['readForAi']>[0]['organizationId'],
    reviewId: Parameters<ReviewRepository['readForAi']>[0]['reviewId'],
  ): Promise<number>
}>

export const createAiReviewSource = (
  dependencies: AiReviewSourceDependencies,
): AiReviewSourcePort => ({
  readCurrentSource: async (input) => {
    const review = await dependencies.findById(input.reviewId, input.organizationId)
    if (!review) return { status: 'not_found' }
    return {
      status: 'available',
      source: {
        organizationId: review.organizationId,
        propertyId: review.propertyId,
        reviewId: review.id,
        sourceEpoch: review.sourceEpoch,
        sourceRevision: review.sourceRevision,
        analysisSequence: review.analysisSequence,
      },
    }
  },
  readForAi: (input) => dependencies.readForAi(input),
  readTrendPopulation: (input) => dependencies.readTrendPopulation(input),
  assertCurrent: (input) => dependencies.assertCurrentForAi(input),
  readReplyStateRevision: (input) =>
    dependencies.readReplyStateRevision(input.organizationId, input.reviewId),
})
