import { describe, expect, it, vi } from 'vitest'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  reviewId,
} from '#/shared/domain/ids'
import type { ReviewRepository } from '../ports/review.repository'
import type { ReviewCommandStore } from '../ports/review-command-store.port'
import type { GoogleReplyObservationStore } from '../ports/google-reply-observation-store.port'
import type { ReviewProviderObservationWriter } from '../ports/review-provider-snapshot.repository'
import type { GoogleReview, Review } from '../../domain/types'
import { computeAiReviewSourceProvenance } from '../ai-review-source'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_SEGMENTS,
} from '#/test-fixtures/generated/google-provider-identifiers-v1'
import {
  createReviewProviderObservationWriter,
  providerReplyObservationKey,
} from './sync-reviews'

const SCOPE_ORG = organizationId('org-review-writer-scope')
const SCOPE_PROPERTY = propertyId('73000000-0000-4000-8000-000000000011')
const SCOPE_REVIEW = reviewId('73000000-0000-4000-8000-000000000012')
const SCOPE_CONNECTION = googleConnectionId('73000000-0000-4000-8000-000000000013')
const SCOPE_NOW = new Date('2026-09-05T10:00:00.000Z')
const SCOPE_PROVIDER_REVIEW = {
  reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
  externalId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId,
  externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
  reviewerName: 'Existing guest',
  reviewerProfilePhotoUrl: null,
  rating: 4,
  text: 'Existing review',
  translatedText: null,
  languageCode: 'en',
  reviewedAt: new Date('2026-08-15T10:00:00.000Z'),
  replyText: null,
  replyUpdatedAt: null,
} satisfies GoogleReview
const SCOPE_AI_PROVENANCE = computeAiReviewSourceProvenance({
  text: SCOPE_PROVIDER_REVIEW.text,
  rating: SCOPE_PROVIDER_REVIEW.rating,
  languageCode: SCOPE_PROVIDER_REVIEW.languageCode,
  reviewedAtEpochMillis: SCOPE_PROVIDER_REVIEW.reviewedAt.getTime(),
  reviewerDisplayName: SCOPE_PROVIDER_REVIEW.reviewerName,
})
const SCOPE_SUBJECT = {
  contractVersion: 'review-provider-subject-v1' as const,
  keyVersion: 'v1',
  locatorHmac: new Uint8Array(32).fill(1),
  verifierHmac: new Uint8Array(32).fill(2),
}

function scopeReview(overrides: Partial<Review> = {}): Review {
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

type ScopeObservationInput = Parameters<ReviewProviderObservationWriter['persist']>[0]

function scopeObservation(
  overrides: Partial<ScopeObservationInput> = {},
): ScopeObservationInput {
  return {
    organizationId: SCOPE_ORG,
    propertyId: SCOPE_PROPERTY,
    connectionId: SCOPE_CONNECTION,
    sourceEpoch: 4,
    observationOrigin: 'ongoing',
    observationKey: 'e'.repeat(64),
    replyReadGeneration: 1,
    subjects: [SCOPE_SUBJECT],
    review: SCOPE_PROVIDER_REVIEW,
    ...overrides,
  }
}

function scopeWriter(existing: Review) {
  const upsert = vi.fn(
    async (review: Omit<Review, 'createdAt' | 'updatedAt'>): Promise<Review> => ({
      ...review,
      createdAt: existing.createdAt,
      updatedAt: SCOPE_NOW,
    }),
  )
  const upsertAndRecord = vi.fn(
    async (review: Omit<Review, 'createdAt' | 'updatedAt'>): Promise<Review> => ({
      ...review,
      sourceRevision: review.sourceRevision + 1,
      analysisSequence: 1,
      createdAt: existing.createdAt,
      updatedAt: SCOPE_NOW,
    }),
  )
  const reobserveExpiredAndRecord = vi.fn(
    async (review: Omit<Review, 'createdAt' | 'updatedAt'>): Promise<Review> => ({
      ...review,
      sourceRevision: review.sourceRevision + 1,
      analysisSequence: 1,
      createdAt: existing.createdAt,
      updatedAt: SCOPE_NOW,
    }),
  )
  const writer = createReviewProviderObservationWriter({
    reviewRepo: {
      findByExternalId: vi.fn(async () => existing),
      findStableIdentityByProviderSubjects: vi.fn(async () => null),
      upsert,
    } as unknown as ReviewRepository,
    clock: () => SCOPE_NOW,
    idGen: vi.fn(() => {
      throw new Error('must preserve the existing ReviewId')
    }),
    commandStore: {
      upsertAndRecord,
      reobserveExpiredAndRecord,
    } as unknown as ReviewCommandStore,
    googleReplyObservationStore: {
      allocateReadGeneration: vi.fn(async () => 1),
      findCurrentHead: vi.fn(async () => null),
      record: vi.fn(async () => ({
        observationRevision: 1,
        change: 'unchanged' as const,
        resolution: 'unchanged' as const,
        matchedReplyId: null,
        matchedPublicationCycle: null,
        duplicate: false,
      })),
    } satisfies GoogleReplyObservationStore,
  })
  return { writer, upsert, upsertAndRecord, reobserveExpiredAndRecord }
}

describe('Review provider observation identity', () => {
  it('does not conflate an absent reply with the literal live reply "absent"', () => {
    const common = {
      providerObservationKey: 'f'.repeat(64),
      sourceEpoch: 4,
      materialReviewRevision: 8,
      replyUpdatedAt: null,
    }

    expect(providerReplyObservationKey({ ...common, replyText: null })).not.toBe(
      providerReplyObservationKey({ ...common, replyText: 'absent' }),
    )
  })

  it('carries the same Review forward after its property source epoch advances', async () => {
    const existing = scopeReview({ sourceEpoch: 3 })
    const { writer, upsert, upsertAndRecord } = scopeWriter(existing)

    await expect(writer.persist(scopeObservation({ sourceEpoch: 4 }))).resolves.toEqual({
      reviewId: existing.id,
      sourceRevision: existing.sourceRevision + 1,
      isNew: false,
    })
    expect(upsertAndRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: existing.id,
        organizationId: existing.organizationId,
        propertyId: existing.propertyId,
        sourceEpoch: 4,
      }),
      expect.any(Function),
      SCOPE_NOW,
      'e'.repeat(64),
      'ongoing',
    )
    expect(upsert).not.toHaveBeenCalled()
  })

  it('carries an expired Review forward through the re-observation path', async () => {
    const existing = scopeReview({
      sourceEpoch: 3,
      contentExpiresAt: new Date('2026-09-04T10:00:00.000Z'),
    })
    const { writer, upsert, reobserveExpiredAndRecord } = scopeWriter(existing)

    await expect(writer.persist(scopeObservation({ sourceEpoch: 4 }))).resolves.toEqual({
      reviewId: existing.id,
      sourceRevision: existing.sourceRevision + 1,
      isNew: false,
    })
    expect(reobserveExpiredAndRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: existing.id,
        propertyId: existing.propertyId,
        sourceEpoch: 4,
      }),
      SCOPE_NOW,
      'e'.repeat(64),
      'ongoing',
    )
    expect(upsert).not.toHaveBeenCalled()
  })

  it('rejects an external Review identity owned by a different Property', async () => {
    const existing = scopeReview({
      propertyId: propertyId('73000000-0000-4000-8000-000000000014'),
      sourceEpoch: 4,
    })
    const { writer, upsert } = scopeWriter(existing)

    await expect(
      writer.persist(scopeObservation({ sourceEpoch: 4 })),
    ).rejects.toMatchObject({
      _tag: 'DomainError',
      code: 'observation_scope_mismatch',
    })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('rejects a stale observation after the stored Review has reached a newer epoch', async () => {
    const existing = scopeReview({ sourceEpoch: 5 })
    const { writer, upsert } = scopeWriter(existing)

    await expect(
      writer.persist(scopeObservation({ sourceEpoch: 4 })),
    ).rejects.toMatchObject({
      _tag: 'DomainError',
      code: 'observation_scope_mismatch',
    })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('rejects an external Review identity outside the observation organization', async () => {
    const existing = scopeReview({
      organizationId: organizationId('org-review-writer-scope-other'),
      sourceEpoch: 3,
    })
    const { writer, upsert } = scopeWriter(existing)

    await expect(
      writer.persist(scopeObservation({ sourceEpoch: 4 })),
    ).rejects.toMatchObject({
      _tag: 'DomainError',
      code: 'observation_scope_mismatch',
    })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('re-observes an erased provider subject on the same stable ReviewId', async () => {
    const org = organizationId('org-review-writer')
    const property = propertyId('73000000-0000-4000-8000-000000000001')
    const stableReview = reviewId('73000000-0000-4000-8000-000000000002')
    const connection = googleConnectionId('73000000-0000-4000-8000-000000000003')
    const now = new Date('2026-08-26T10:00:00.000Z')
    const reobserveExpiredAndRecord = vi.fn(async (review) => ({
      ...review,
      sourceRevision: review.sourceRevision + 1,
      analysisSequence: review.analysisSequence + 2,
      createdAt: now,
      updatedAt: now,
    }))
    const writer = createReviewProviderObservationWriter({
      reviewRepo: {
        findByExternalId: vi.fn(async () => null),
        findStableIdentityByProviderSubjects: vi.fn(async () => ({
          id: stableReview,
          organizationId: org,
          propertyId: property,
          sourceEpoch: 4,
          sourceRevision: 7,
          analysisSequence: 11,
          sourceContentState: 'provider_deleted' as const,
          firstFetchedAt: new Date('2026-07-01T10:00:00.000Z'),
          sourceSeenGeneration: null,
          sentimentLabel: 'negative',
          sentimentScore: -0.8,
        })),
      } as unknown as ReviewRepository,
      clock: () => now,
      idGen: vi.fn(() => {
        throw new Error('must not allocate a replacement ReviewId')
      }),
      commandStore: {
        reobserveExpiredAndRecord,
      } as unknown as ReviewCommandStore,
      googleReplyObservationStore: {
        allocateReadGeneration: vi.fn(async () => 1),
        findCurrentHead: vi.fn(async () => null),
        record: vi.fn(async () => ({
          observationRevision: 1,
          change: 'unchanged' as const,
          resolution: 'unchanged' as const,
          matchedReplyId: null,
          matchedPublicationCycle: null,
          duplicate: false,
        })),
      } satisfies GoogleReplyObservationStore,
    })
    const subject = {
      contractVersion: 'review-provider-subject-v1' as const,
      keyVersion: 'v1',
      locatorHmac: new Uint8Array(32).fill(1),
      verifierHmac: new Uint8Array(32).fill(2),
    }

    const result = await writer.persist({
      organizationId: org,
      propertyId: property,
      connectionId: connection,
      sourceEpoch: 4,
      observationOrigin: 'ongoing',
      observationKey: 'f'.repeat(64),
      replyReadGeneration: 1,
      subjects: [subject],
      review: {
        reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
        externalId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId,
        externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
        reviewerName: 'Guest',
        reviewerProfilePhotoUrl: null,
        rating: 2,
        text: 'Corrected source content',
        translatedText: null,
        languageCode: 'en',
        reviewedAt: new Date('2026-08-20T10:00:00.000Z'),
        replyText: null,
        replyUpdatedAt: null,
      },
    })

    expect(reobserveExpiredAndRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: stableReview,
        sourceEpoch: 4,
        sourceRevision: 7,
        analysisSequence: 11,
      }),
      now,
      'f'.repeat(64),
      'ongoing',
    )
    expect(result).toEqual({ reviewId: stableReview, sourceRevision: 8, isNew: false })
  })
})
