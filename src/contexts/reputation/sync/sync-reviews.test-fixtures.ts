import { createHash } from 'node:crypto'
import { vi } from 'vitest'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  reviewId,
} from '#/shared/domain/ids'
import type { ReviewRepository } from '../reviews/review-repository.port.server'
import type { ReviewCommandStore } from '../reviews/review-command-store.port.server'
import type { GoogleReplyObservationStore } from '../publication/google-reply-observation-store.port.server'
import type { ReviewProviderHistoryCutoff } from './review-provider-snapshot-repository.port.server'
import type { ReviewProviderObservationWriter } from './sync-reviews.port.server'
import type { GoogleReview, Review } from '../domain/review-types'
import { canonicalizeRawAiReviewSourcePreviousRevision } from '#/shared/ai-review-source/ai-review-source-contract'
import { computeAiReviewSourceProvenance } from '../reviews/ai-review-source.server'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_SEGMENTS,
} from '#/shared/testing/google-provider-identifiers-v1'
import { createReviewProviderObservationWriter } from './sync-reviews.server'

export const SCOPE_ORG = organizationId('org-review-writer-scope')
export const SCOPE_PROPERTY = propertyId('73000000-0000-4000-8000-000000000011')
export const SCOPE_REVIEW = reviewId('73000000-0000-4000-8000-000000000012')
export const SCOPE_CONNECTION = googleConnectionId('73000000-0000-4000-8000-000000000013')
export const SCOPE_NOW = new Date('2026-09-05T10:00:00.000Z')
export const SCOPE_PROVIDER_REVIEW = {
  reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
  externalId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId,
  externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
  reviewerName: 'Existing guest',
  reviewerProfilePhotoUrl: null,
  googleReviewUrl: null,
  rating: 4,
  text: 'Existing review',
  translatedText: null,
  languageCode: 'en',
  reviewedAt: new Date('2026-08-15T10:00:00.000Z'),
  replyText: null,
  replyUpdatedAt: null,
} satisfies GoogleReview
export const SCOPE_AI_PROVENANCE = computeAiReviewSourceProvenance({
  text: SCOPE_PROVIDER_REVIEW.text,
  rating: SCOPE_PROVIDER_REVIEW.rating,
  languageCode: SCOPE_PROVIDER_REVIEW.languageCode,
  reviewedAtEpochMillis: SCOPE_PROVIDER_REVIEW.reviewedAt.getTime(),
  reviewerDisplayName: SCOPE_PROVIDER_REVIEW.reviewerName,
})
export const SCOPE_SUBJECT = {
  contractVersion: 'review-provider-subject-v1' as const,
  keyVersion: 'v1',
  locatorHmac: new Uint8Array(32).fill(1),
  verifierHmac: new Uint8Array(32).fill(2),
}

export function scopeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: SCOPE_REVIEW,
    organizationId: SCOPE_ORG,
    propertyId: SCOPE_PROPERTY,
    platform: 'google',
    externalId: SCOPE_PROVIDER_REVIEW.externalId,
    externalLocationId: SCOPE_PROVIDER_REVIEW.externalLocationId,
    googleConnectionId: SCOPE_CONNECTION,
    reviewerName: SCOPE_PROVIDER_REVIEW.reviewerName,
    reviewerProfilePhotoUrl: SCOPE_PROVIDER_REVIEW.reviewerProfilePhotoUrl,
    googleReviewUrl: SCOPE_PROVIDER_REVIEW.googleReviewUrl,
    rating: SCOPE_PROVIDER_REVIEW.rating,
    text: SCOPE_PROVIDER_REVIEW.text,
    translatedText: SCOPE_PROVIDER_REVIEW.translatedText,
    languageCode: SCOPE_PROVIDER_REVIEW.languageCode,
    reviewedAt: SCOPE_PROVIDER_REVIEW.reviewedAt,
    expiresAt: new Date('2027-08-15T10:00:00.000Z'),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: SCOPE_PROVIDER_REVIEW.reviewedAt,
    sourceUpdatedAt: null,
    firstFetchedAt: SCOPE_PROVIDER_REVIEW.reviewedAt,
    lastFetchedAt: SCOPE_PROVIDER_REVIEW.reviewedAt,
    contentExpiresAt: new Date('2026-10-05T10:00:00.000Z'),
    contentHash: 'existing-content-hash',
    sourceSeenGeneration: null,
    sourceEpoch: 3,
    sourceRevision: 1,
    analysisSequence: 1,
    aiSourceByteLength: SCOPE_AI_PROVENANCE.byteLength,
    aiSourceDigest: SCOPE_AI_PROVENANCE.digest,
    createdAt: SCOPE_PROVIDER_REVIEW.reviewedAt,
    updatedAt: SCOPE_PROVIDER_REVIEW.reviewedAt,
    ...overrides,
  }
}

export type ScopeObservationInput = Parameters<
  ReviewProviderObservationWriter['persist']
>[0]
export type RecordedReplyObservation = Parameters<
  GoogleReplyObservationStore['record']
>[0]

export function scopeObservation(
  overrides: Partial<ScopeObservationInput> = {},
): ScopeObservationInput {
  return {
    organizationId: SCOPE_ORG,
    propertyId: SCOPE_PROPERTY,
    connectionId: SCOPE_CONNECTION,
    sourceEpoch: 4,
    observationOrigin: 'ongoing',
    firstSeenVia: 'snapshot',
    observationKey: 'e'.repeat(64),
    replyReadGeneration: 1,
    subjects: [SCOPE_SUBJECT],
    review: SCOPE_PROVIDER_REVIEW,
    ...overrides,
  }
}

/**
 * An imported epoch's history: its own cutoff, the Property's first import
 * cutoff (the same one unless the epoch began with a relink), and whether a
 * run has listed the epoch's history in full since the cutoff.
 */
export function historyAt(
  cutoffAt: Date,
  overrides: Partial<ReviewProviderHistoryCutoff> = {},
): ReviewProviderHistoryCutoff {
  return { cutoffAt, firstImportCutoffAt: cutoffAt, historyListed: false, ...overrides }
}

export type ScopeStableIdentity = Awaited<
  ReturnType<ReviewRepository['findStableIdentityByProviderSubjects']>
>

export function scopeWriter(
  existing: Review | null,
  history: ReviewProviderHistoryCutoff | null = null,
  stableIdentity: ScopeStableIdentity = null,
) {
  const createdAt = existing?.createdAt ?? SCOPE_NOW
  const upsert = vi.fn(
    async (review: Omit<Review, 'createdAt' | 'updatedAt'>): Promise<Review> => ({
      ...review,
      createdAt,
      updatedAt: SCOPE_NOW,
    }),
  )
  const upsertAndRecord = vi.fn(
    async (review: Omit<Review, 'createdAt' | 'updatedAt'>): Promise<Review> => ({
      ...review,
      sourceRevision: review.sourceRevision + 1,
      analysisSequence: 1,
      createdAt,
      updatedAt: SCOPE_NOW,
    }),
  )
  const reobserveExpiredAndRecord = vi.fn(
    async (review: Omit<Review, 'createdAt' | 'updatedAt'>): Promise<Review> => ({
      ...review,
      sourceRevision: review.sourceRevision + 1,
      analysisSequence: 1,
      createdAt,
      updatedAt: SCOPE_NOW,
    }),
  )
  const readHistoryCutoff = vi.fn(async () => history)
  const record = vi.fn(async (_observation: RecordedReplyObservation) => ({
    observationRevision: 1,
    change: 'unchanged' as const,
    resolution: 'unchanged' as const,
    matchedReplyId: null,
    matchedPublicationCycle: null,
    duplicate: false,
  }))
  const writer = createReviewProviderObservationWriter({
    reviewRepo: {
      findByExternalId: vi.fn(async () => existing),
      findStableIdentityByProviderSubjects: vi.fn(async () => stableIdentity),
      upsert,
    } as unknown as ReviewRepository,
    clock: () => SCOPE_NOW,
    idGen: vi.fn(() => {
      if (existing == null && stableIdentity == null) return SCOPE_REVIEW
      throw new Error('must preserve the existing ReviewId')
    }),
    commandStore: {
      upsertAndRecord,
      reobserveExpiredAndRecord,
    } as unknown as ReviewCommandStore,
    googleReplyObservationStore: {
      allocateReadGeneration: vi.fn(async () => 1),
      findCurrentHead: vi.fn(async () => null),
      record,
    } satisfies GoogleReplyObservationStore,
    historyCutoffs: { readHistoryCutoff },
  })
  return {
    writer,
    upsert,
    upsertAndRecord,
    reobserveExpiredAndRecord,
    readHistoryCutoff,
    record,
  }
}

/** The origin the writer recorded, on both the revision write and its event. */
export async function recordedOrigins(
  upsertAndRecord: ReturnType<typeof scopeWriter>['upsertAndRecord'],
) {
  const call = upsertAndRecord.mock.calls[0] as unknown as unknown[]
  const eventFor = call[1] as (
    persisted: Review,
  ) => Readonly<{ _tag: string; observationOrigin?: string }>
  const persisted = await upsertAndRecord.mock.results[0]?.value
  return { stored: call[4], event: eventFor(persisted) }
}

/** The provenance a Review stored under revision 1 of the source text rules holds. */
export function revisionOneProvenance(review: GoogleReview) {
  const canonical = canonicalizeRawAiReviewSourcePreviousRevision({
    text: review.text,
    rating: review.rating,
    languageCode: review.languageCode,
    reviewedAtEpochMillis: review.reviewedAt.getTime(),
    reviewerDisplayName: review.reviewerName,
  })
  return {
    byteLength: canonical.bytes.byteLength,
    digest: createHash('sha256')
      .update('ai-source-v1\0', 'utf8')
      .update(canonical.bytes)
      .digest('hex'),
  }
}

/** The first-sighting argument the writer handed the command store. */
export const sightingOf = (
  upsertAndRecord: ReturnType<typeof scopeWriter>['upsertAndRecord'],
) => (upsertAndRecord.mock.calls[0] as unknown as unknown[])[5]
