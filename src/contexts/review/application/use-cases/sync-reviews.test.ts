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
import {
  createReviewProviderObservationWriter,
  providerReplyObservationKey,
} from './sync-reviews'

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
      observationKey: 'f'.repeat(64),
      replyReadGeneration: 1,
      subjects: [subject],
      review: {
        reviewName: 'accounts/a/locations/l/reviews/r',
        externalId: 'r',
        externalLocationId: 'accounts/a/locations/l',
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
    )
    expect(result).toEqual({ reviewId: stableReview, sourceRevision: 8, isNew: false })
  })
})
