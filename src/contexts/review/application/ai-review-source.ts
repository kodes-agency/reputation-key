import { createHash, timingSafeEqual } from 'node:crypto'
import {
  AI_REVIEW_SOURCE_CONTRACT_VERSION,
  canonicalizeRawAiReviewSource,
  canonicalizeRawAiReviewSourcePreviousRevision,
  type CanonicalAiReviewSource,
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

export type AiReviewSourceInput = Readonly<{
  text: string | null
  rating: StarRating
  languageCode: string | null
  reviewedAtEpochMillis: number
  reviewerDisplayName: string | null
}>

function provenanceOf(canonical: CanonicalAiReviewSource): AiReviewSourceProvenance {
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

/**
 * The sole Review-side raw canonicalization integration. It delegates every
 * normalization and identity-minimization rule to the shared contract.
 */
export function computeAiReviewSourceProvenance(
  input: AiReviewSourceInput,
): AiReviewSourceProvenance {
  return provenanceOf(canonicalizeRawAiReviewSource(input))
}

function sameStoredProvenance(
  provenance: AiReviewSourceProvenance,
  stored: StoredAiReviewSourceProvenance,
): boolean {
  const expected = Buffer.from(stored.digest, 'hex')
  const actual = Buffer.from(provenance.digest, 'hex')
  return (
    provenance.byteLength === stored.byteLength &&
    expected.byteLength === actual.byteLength &&
    timingSafeEqual(expected, actual)
  )
}

export type StoredAiReviewSourceProvenance = Readonly<{
  digest: string
  byteLength: number
}>

/**
 * The provenance a stored Review row describes: the one the current text rules
 * compute from the row's raw source, else the one revision 1 of the rules
 * computed, else null.
 *
 * A Review written before revision 2 (`AI_SOURCE_TEXT_REVISION`) stores a
 * digest and byte length over text whose line breaks and tabs were deleted.
 * Until a sync observation rewrites the row, that stored pair is the only
 * provenance every later check agrees on, and the AI context compares the digest
 * of the text it is served with the one the Review stores. So the row is served
 * under the revision it was stored under, and rewritten under the current one by
 * its next observation, with no `review.updated` and no new analysis sequence
 * (`sync-reviews.ts`, `classifyObservation`).
 *
 * Remove the second branch once no active Review row predates revision 2: raw
 * content is observed again at least every 25 days and expires at 30
 * (ADR 0031), so that is 30 days after the release that carries revision 2.
 */
export function matchStoredAiReviewSourceProvenance(
  input: AiReviewSourceInput,
  stored: StoredAiReviewSourceProvenance,
): AiReviewSourceProvenance | null {
  let currentFailure: unknown = null
  try {
    const current = computeAiReviewSourceProvenance(input)
    if (sameStoredProvenance(current, stored)) return current
  } catch (error) {
    // A line break kept as a space can push a text past the byte limit that
    // revision 1 stayed under: the stored row may still be revision 1's.
    currentFailure = error
  }
  const previous = previousRevisionProvenance(input)
  if (previous !== null && sameStoredProvenance(previous, stored)) return previous
  if (currentFailure !== null) throw currentFailure
  return null
}

function previousRevisionProvenance(
  input: AiReviewSourceInput,
): AiReviewSourceProvenance | null {
  try {
    return provenanceOf(canonicalizeRawAiReviewSourcePreviousRevision(input))
  } catch {
    return null
  }
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
