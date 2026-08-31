import { describe, expect, it } from 'vitest'
import {
  organizationId,
  propertyId,
  replyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import {
  reviewCreated,
  reviewExpired,
  reviewGoogleReputationSnapshotVerified,
  reviewReplyApproved,
  reviewReplyPublicationRequested,
  reviewReplyPublicationCancelled,
  reviewReplyObserved,
  reviewReplyPublishFailed,
  reviewReplyPublished,
  reviewReplyRejected,
  reviewReplySubmitted,
  reviewReplyUpdated,
  reviewSourceTransitioned,
  reviewUpdated,
} from './events'

const occurredAt = new Date('2026-08-16T12:00:00.000Z')
const OBSERVED_REVIEW_ID = reviewId('11111111-1111-4111-8111-111111111111')
const OBSERVED_PROPERTY_ID = propertyId('22222222-2222-4222-8222-222222222222')
const OBSERVED_REPLY_ID = replyId('33333333-3333-4333-8333-333333333333')
const baseReview = {
  reviewId: reviewId('review-1'),
  propertyId: propertyId('property-1'),
  organizationId: organizationId('organization-1'),
  occurredAt,
}
const sourceVersion = {
  sourceEpoch: 0,
  sourceRevision: 1,
  analysisSequence: 1,
}
const baseReply = {
  replyId: replyId('reply-1'),
  ...baseReview,
}
const baseObserved = {
  reviewId: OBSERVED_REVIEW_ID,
  propertyId: OBSERVED_PROPERTY_ID,
  organizationId: organizationId('organization-1'),
  occurredAt,
  observationRevision: 2,
  sourceEpoch: 1,
  materialReviewRevision: 3,
  change: 'edited' as const,
  resolution: 'diverged' as const,
  provenance: 'external_or_unknown' as const,
  matchedReplyId: null,
  matchedPublicationCycle: null,
}
const basePublicationRequested = {
  replyId: OBSERVED_REPLY_ID,
  reviewId: OBSERVED_REVIEW_ID,
  propertyId: OBSERVED_PROPERTY_ID,
  organizationId: organizationId('organization-1'),
  userId: userId('user-1'),
  publicationCycle: 1,
  sourceEpoch: 0,
  materialReviewRevision: 1,
  baseObservationRevision: 0,
  occurredAt,
}

const expectEnvelope = (event: {
  _tag: string
  eventId: string
  correlationId: string | null
}) => {
  expect(event.eventId).toMatch(/^[0-9a-f-]{36}$/)
  expect(event.correlationId).toBeNull()
}

describe('review domain events', () => {
  it('builds identifier-only review lifecycle envelopes', () => {
    const created = reviewCreated({
      ...baseReview,
      ...sourceVersion,
      platform: 'google',
    })
    const updated = reviewUpdated({
      ...baseReview,
      ...sourceVersion,
      platform: 'google',
      correlationId: 'correlation-1',
    })
    const expired = reviewExpired(baseReview)
    const transitioned = reviewSourceTransitioned({
      ...baseReview,
      ...sourceVersion,
      change: 'provider_deleted',
    })

    expect(created._tag).toBe('review.created')
    expectEnvelope(created)
    expect(updated).toMatchObject({
      _tag: 'review.updated',
      correlationId: 'correlation-1',
    })
    expect(expired._tag).toBe('review.expired')
    expectEnvelope(expired)
    expect(transitioned._tag).toBe('review.source_transitioned')
    expectEnvelope(transitioned)
  })

  it('builds a content-minimal verified Google reputation snapshot fact', () => {
    const event = reviewGoogleReputationSnapshotVerified({
      organizationId: organizationId('organization-1'),
      propertyId: OBSERVED_PROPERTY_ID,
      sourceEpoch: 3,
      runId: '44444444-4444-4444-8444-444444444444',
      reviewCount: 42,
      averageRating: 4.6,
      evaluatedAt: occurredAt,
      occurredAt,
    })

    expect(event).toMatchObject({
      _tag: 'review.google_reputation_snapshot.verified',
      reviewCount: 42,
      averageRating: 4.6,
      sourceAggregateVersion: occurredAt.toISOString(),
    })
    expectEnvelope(event)
    expect(JSON.stringify(event)).not.toMatch(/reviewText|reviewerName|replyText/u)
  })

  it.each([
    { reviewCount: 0, averageRating: 4 },
    { reviewCount: 1, averageRating: null },
    { reviewCount: 1, averageRating: 5.1 },
  ])('rejects invalid verified aggregate semantics: %o', (aggregate) => {
    expect(() =>
      reviewGoogleReputationSnapshotVerified({
        organizationId: organizationId('organization-1'),
        propertyId: OBSERVED_PROPERTY_ID,
        sourceEpoch: 3,
        runId: '44444444-4444-4444-8444-444444444444',
        evaluatedAt: occurredAt,
        occurredAt,
        ...aggregate,
      }),
    ).toThrow('averageRating must match')
  })

  it('requires the verified event clock to match its provider evaluation clock', () => {
    expect(() =>
      reviewGoogleReputationSnapshotVerified({
        organizationId: organizationId('organization-1'),
        propertyId: OBSERVED_PROPERTY_ID,
        sourceEpoch: 3,
        runId: '44444444-4444-4444-8444-444444444444',
        reviewCount: 1,
        averageRating: 5,
        evaluatedAt: occurredAt,
        occurredAt: new Date(occurredAt.getTime() + 1),
      }),
    ).toThrow('occurredAt must equal evaluatedAt')
  })

  it('builds every reply lifecycle envelope with explicit and default sources', () => {
    const submitted = reviewReplySubmitted({
      ...baseReply,
      userId: userId('user-1'),
    })
    const approved = reviewReplyApproved({
      ...baseReply,
      userId: userId('user-1'),
      authorId: userId('author-1'),
      source: 'import',
    })
    const publicationRequested = reviewReplyPublicationRequested({
      ...basePublicationRequested,
    })
    const rejected = reviewReplyRejected({
      ...baseReply,
      userId: userId('user-1'),
      authorId: null,
      reason: 'policy',
    })
    const published = reviewReplyPublished({
      ...baseReply,
      userId: userId('user-1'),
      authorId: userId('author-1'),
    })
    const failed = reviewReplyPublishFailed({ ...baseReply, authorId: null })
    const updated = reviewReplyUpdated({ ...baseReply, userId: null })
    const cancelled = reviewReplyPublicationCancelled({
      ...baseReply,
      replyId: OBSERVED_REPLY_ID,
      reviewId: OBSERVED_REVIEW_ID,
      propertyId: OBSERVED_PROPERTY_ID,
      cause: 'disconnect',
    })
    const observed = reviewReplyObserved(baseObserved)

    expect(submitted).toMatchObject({ _tag: 'review.reply.submitted', source: 'web' })
    expect(approved).toMatchObject({ _tag: 'review.reply.approved', source: 'import' })
    expect(publicationRequested).toMatchObject({
      _tag: 'review.reply.publication_requested',
      publicationCycle: 1,
    })
    expect(rejected).toMatchObject({ _tag: 'review.reply.rejected', source: 'web' })
    expect(published).toMatchObject({ _tag: 'review.reply.published', source: 'web' })
    expect(failed._tag).toBe('review.reply.publish_failed')
    expect(updated._tag).toBe('review.reply.updated')
    expect(cancelled._tag).toBe('review.reply.publication_cancelled')
    expect(observed).toMatchObject({
      _tag: 'review.reply.observed',
      observationRevision: 2,
      change: 'edited',
      resolution: 'diverged',
    })
    for (const event of [
      submitted,
      approved,
      publicationRequested,
      rejected,
      published,
      failed,
      updated,
      cancelled,
      observed,
    ]) {
      expectEnvelope(event)
    }
  })

  it.each([
    ['invalid occurredAt', { occurredAt: new Date(Number.NaN) }, 'valid Date'],
    ['empty organizationId', { organizationId: organizationId('') }, 'nonempty'],
    ['non-UUID replyId', { replyId: replyId('reply-1') }, 'replyId'],
    ['non-UUID reviewId', { reviewId: reviewId('review-1') }, 'reviewId'],
    ['non-UUID propertyId', { propertyId: propertyId('property-1') }, 'propertyId'],
    ['invalid cause', { cause: 'unknown' }, 'cancellation cause'],
  ])('rejects publication cancellation with %s', (_name, override, message) => {
    expect(() =>
      reviewReplyPublicationCancelled({
        replyId: OBSERVED_REPLY_ID,
        reviewId: OBSERVED_REVIEW_ID,
        propertyId: OBSERVED_PROPERTY_ID,
        organizationId: organizationId('organization-1'),
        cause: 'disconnect',
        occurredAt,
        ...override,
      } as Parameters<typeof reviewReplyPublicationCancelled>[0]),
    ).toThrow(message)
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid publication cycle %s',
    (publicationCycle) => {
      expect(() =>
        reviewReplyPublicationRequested({
          ...basePublicationRequested,
          publicationCycle,
        }),
      ).toThrow('publicationCycle must be a positive safe integer')
    },
  )

  it.each([
    ['invalid occurredAt', { occurredAt: new Date(Number.NaN) }, 'valid Date'],
    ['empty organizationId', { organizationId: organizationId('') }, 'nonempty'],
    ['empty userId', { userId: userId('  ') }, 'nonempty'],
    ['non-UUID replyId', { replyId: replyId('reply-1') }, 'replyId'],
    ['non-UUID reviewId', { reviewId: reviewId('review-1') }, 'reviewId'],
    ['non-UUID propertyId', { propertyId: propertyId('property-1') }, 'propertyId'],
  ])('rejects publication request with %s', (_name, override, message) => {
    expect(() =>
      reviewReplyPublicationRequested({
        ...basePublicationRequested,
        ...override,
      } as Parameters<typeof reviewReplyPublicationRequested>[0]),
    ).toThrow(message)
  })

  it.each([
    {
      name: 'confirmed resolution without RepKey provenance',
      override: {
        change: 'added',
        resolution: 'confirmed_on_google',
        provenance: 'external_or_unknown',
        matchedReplyId: OBSERVED_REPLY_ID,
        matchedPublicationCycle: 1,
      },
    },
    {
      name: 'confirmed resolution without an exact Reply match',
      override: {
        change: 'added',
        resolution: 'confirmed_on_google',
        provenance: 'repkey_confirmed',
        matchedReplyId: null,
        matchedPublicationCycle: null,
      },
    },
    {
      name: 'divergence carrying RepKey provenance and a match',
      override: {
        resolution: 'diverged',
        provenance: 'repkey_confirmed',
        matchedReplyId: OBSERVED_REPLY_ID,
        matchedPublicationCycle: 1,
      },
    },
    {
      name: 'absence without a deletion',
      override: {
        change: 'added',
        resolution: 'absent',
        provenance: 'none',
      },
    },
  ])('rejects semantically impossible observation: $name', ({ override }) => {
    expect(() =>
      reviewReplyObserved({
        ...baseObserved,
        ...override,
      } as Parameters<typeof reviewReplyObserved>[0]),
    ).toThrow('review reply observation semantics are invalid')
  })

  it('accepts an externally edited current-live reply without RepKey attribution', () => {
    expect(
      reviewReplyObserved({
        ...baseObserved,
        change: 'edited',
        resolution: 'external_current_live',
        provenance: 'external_or_unknown',
      }),
    ).toMatchObject({ change: 'edited', resolution: 'external_current_live' })
  })

  it('accepts an unchanged external-current-live head for a newer attempt', () => {
    expect(
      reviewReplyObserved({
        ...baseObserved,
        change: 'unchanged',
        resolution: 'external_current_live',
        provenance: 'external_or_unknown',
      }),
    ).toMatchObject({ change: 'unchanged', resolution: 'external_current_live' })
  })

  it.each([
    ['invalid occurredAt', { occurredAt: new Date(Number.NaN) }, 'valid Date'],
    ['empty organizationId', { organizationId: organizationId('') }, 'nonempty'],
    ['non-UUID reviewId', { reviewId: reviewId('review-1') }, 'reviewId'],
    ['non-UUID propertyId', { propertyId: propertyId('property-1') }, 'propertyId'],
    [
      'non-UUID matchedReplyId',
      {
        change: 'added',
        resolution: 'confirmed_on_google',
        provenance: 'repkey_confirmed',
        matchedReplyId: replyId('reply-1'),
        matchedPublicationCycle: 1,
      },
      'matchedReplyId',
    ],
  ])('rejects observation with %s', (_name, override, message) => {
    expect(() =>
      reviewReplyObserved({
        ...baseObserved,
        ...override,
      } as Parameters<typeof reviewReplyObserved>[0]),
    ).toThrow(message)
  })

  it.each([
    ['occurredAt', { occurredAt: '2026-08-16' }, 'occurredAt must be a Date'],
    [
      'sourceEpoch',
      { sourceEpoch: -1 },
      'sourceEpoch must be a nonnegative safe integer',
    ],
    [
      'sourceRevision',
      { sourceRevision: 0 },
      'sourceRevision must be a positive safe integer',
    ],
    [
      'analysisSequence',
      { analysisSequence: 0 },
      'analysisSequence must be a positive safe integer',
    ],
  ])('rejects an invalid %s', (_field, override, message) => {
    const invalid = {
      ...baseReview,
      ...sourceVersion,
      platform: 'google',
      ...override,
    } as unknown as Parameters<typeof reviewCreated>[0]
    expect(() => reviewCreated(invalid)).toThrow(message)
  })
})
