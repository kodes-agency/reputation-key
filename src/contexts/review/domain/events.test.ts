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
  reviewReplyApproved,
  reviewReplyPublicationCancelled,
  reviewReplyPublishFailed,
  reviewReplyPublished,
  reviewReplyRejected,
  reviewReplySubmitted,
  reviewReplyUpdated,
  reviewSourceTransitioned,
  reviewUpdated,
} from './events'

const occurredAt = new Date('2026-08-16T12:00:00.000Z')
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
      cause: 'disconnect',
    })

    expect(submitted).toMatchObject({ _tag: 'review.reply.submitted', source: 'web' })
    expect(approved).toMatchObject({ _tag: 'review.reply.approved', source: 'import' })
    expect(rejected).toMatchObject({ _tag: 'review.reply.rejected', source: 'web' })
    expect(published).toMatchObject({ _tag: 'review.reply.published', source: 'web' })
    expect(failed._tag).toBe('review.reply.publish_failed')
    expect(updated._tag).toBe('review.reply.updated')
    expect(cancelled._tag).toBe('review.reply.publication_cancelled')
    for (const event of [
      submitted,
      approved,
      rejected,
      published,
      failed,
      updated,
      cancelled,
    ]) {
      expectEnvelope(event)
    }
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
