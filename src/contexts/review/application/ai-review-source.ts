import { createHash, timingSafeEqual } from 'node:crypto'
import {
  AI_REVIEW_SOURCE_CONTRACT_VERSION,
  AiReviewSourceRefusal,
  MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1,
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

/**
 * The byte length a Review row stores for a source the AI contract refuses:
 * one over the canonical limit, so every reader that denies an oversize source
 * (`readForAi`, `assertCurrentForAi` answer `source_too_large`; the eligibility
 * counts leave it out) denies this one too.
 */
export const REFUSED_AI_SOURCE_BYTE_LENGTH = MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1 + 1

const REFUSED_DIGEST_PREFIX = new TextEncoder().encode(
  `${AI_REVIEW_SOURCE_CONTRACT_VERSION}-refused\0`,
)

/**
 * The provenance pair the Review writer stores for one observation. A source
 * the contract refuses (canonical form over 16 KB once NFKC has expanded it, an
 * unpaired surrogate) is no reason to refuse the Review: it is Google's content
 * and the Inbox, the Dashboard and the reply workflow need it. It is stored
 * marked as over the limit, which the AI readers already deny, and its digest
 * covers the raw fields the real digest covers, so an edit of the text still
 * reads as a changed review. Whether the AI should ever read such a text
 * (skipped, as it is, or truncated) is a product question, `ai/CONTEXT.md`.
 */
export function storedAiReviewSourceProvenance(
  input: AiReviewSourceInput,
): StoredAiReviewSourceProvenance {
  try {
    const { byteLength, digest } = computeAiReviewSourceProvenance(input)
    return { byteLength, digest }
  } catch (error) {
    if (!(error instanceof AiReviewSourceRefusal)) throw error
    return refusedProvenance(input)
  }
}

function refusedProvenance(input: AiReviewSourceInput): StoredAiReviewSourceProvenance {
  const fields = JSON.stringify([
    input.text,
    input.rating,
    input.languageCode,
    input.reviewedAtEpochMillis,
  ])
  return {
    byteLength: REFUSED_AI_SOURCE_BYTE_LENGTH,
    digest: createHash('sha256')
      .update(REFUSED_DIGEST_PREFIX)
      .update(fields, 'utf8')
      .digest('hex'),
  }
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

/**
 * `matchStoredAiReviewSourceProvenance` for a caller that reads a source the
 * contract refuses as "describes no stored row" instead of as a failure. Any
 * other error is not an answer about the source and still throws.
 */
export function findStoredAiReviewSourceProvenance(
  input: AiReviewSourceInput,
  stored: StoredAiReviewSourceProvenance,
): AiReviewSourceProvenance | null {
  try {
    return matchStoredAiReviewSourceProvenance(input, stored)
  } catch (error) {
    if (error instanceof AiReviewSourceRefusal) return null
    throw error
  }
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
