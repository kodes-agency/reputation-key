import { describe, expect, it } from 'vitest'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
} from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'
import type { ReviewSnippet } from '../../application/ports/review-lookup.port'
import { feedbackItemDetail, reviewItemDetail } from './inbox-detail.mapper'

const AT = new Date('2026-10-01T09:00:00.000Z')
/** Synthetic (test-fixtures/google-provider-identifiers-v1.json). */
const REVIEW_PAGE =
  'https://business.google.com/n/repkey-synthetic-do-not-use-location-0001/reviews/repkey-synthetic-do-not-use-reply-token-0001'

const item: InboxItem = {
  id: inboxItemId('00000000-0000-4000-8000-0000000000d1'),
  organizationId: organizationId('org-detail-mapper'),
  propertyId: propertyId('00000000-0000-4000-8000-0000000000d2'),
  sourceType: 'review',
  sourceId: reviewId('00000000-0000-4000-8000-0000000000d3'),
  status: 'open',
  isEscalated: false,
  escalatedAt: null,
  escalatedBy: null,
  escalationResolvedAt: null,
  escalationResolvedBy: null,
  rating: null,
  sourceDate: AT,
  platform: 'google',
  snippet: null,
  assignedTo: null,
  reviewerName: null,
  propertyName: 'Seaside Rooms',
  closedAt: null,
  firstReplySubmittedAt: null,
  firstReplyPublishedAt: null,
  commandRevision: 1,
  createdAt: AT,
  updatedAt: AT,
}

const snippet: ReviewSnippet = {
  reviewerName: 'Guest',
  text: 'Quiet room.',
  translatedText: null,
  reviewerProfilePhotoUrl: null,
  googleReviewUrl: REVIEW_PAGE,
  rating: 4,
  languageCode: 'en',
}

describe('reviewItemDetail', () => {
  it("serves the review's words, stars and Google page together", () => {
    const detail = reviewItemDetail(item, { status: 'available', snippet })

    expect(detail).toMatchObject({
      reviewText: 'Quiet room.',
      reviewRating: 4,
      googleReviewUrl: REVIEW_PAGE,
      reviewContentStatus: 'available',
      item: {
        reviewerName: 'Guest',
        reviewLanguageCode: 'en',
        propertyName: 'Seaside Rooms',
      },
    })
  })

  it.each(['expired', 'not_found'] as const)(
    'serves no content and no Google page for a review that is %s',
    (status) => {
      const detail = reviewItemDetail(item, { status })

      expect(detail).toMatchObject({
        reviewText: null,
        reviewTranslatedText: null,
        reviewerProfilePhotoUrl: null,
        googleReviewUrl: null,
        reviewRating: null,
        reviewContentStatus: status,
        item: { reviewerName: null, reviewLanguageCode: null },
      })
    },
  )
})

describe('feedbackItemDetail', () => {
  it('carries the feedback and no review content or Google page', () => {
    const detail = feedbackItemDetail(
      { ...item, sourceType: 'feedback', sourceId: feedbackId('fb-detail-mapper') },
      { comment: 'Lovely staff.', ratingValue: 5 },
    )

    expect(detail).toMatchObject({
      reviewText: null,
      googleReviewUrl: null,
      reviewContentStatus: null,
      reviewRating: null,
      feedbackComment: 'Lovely staff.',
      feedbackRatingValue: 5,
      item: { reviewerName: null },
    })
  })
})
