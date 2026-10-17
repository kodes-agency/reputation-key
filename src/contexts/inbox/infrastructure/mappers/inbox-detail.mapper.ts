// Inbox context — the detail view of one item, from what the owning context's
// lookup answered. Pure: the repository reads, these say what the pane is told.

import type { FeedbackSnippet } from '../../application/ports/feedback-lookup.port'
import type { ReviewSnippetResult } from '../../application/ports/review-lookup.port'
import type { InboxItem, InboxItemDetail } from '../../domain/types'

/**
 * A Review item's detail. BQC-1.2: content comes only from the
 * eligibility-enforcing lookup; expired/missing yields a typed status, never
 * stale fields, and every content field below is null with it.
 */
export function reviewItemDetail(
  item: InboxItem,
  result: ReviewSnippetResult,
): InboxItemDetail {
  const snippet = result.status === 'available' ? result.snippet : null
  return {
    item: {
      ...item,
      reviewerName: snippet?.reviewerName ?? null,
      reviewLanguageCode: snippet?.languageCode ?? null,
    },
    reviewText: snippet?.text ?? null,
    reviewTranslatedText: snippet?.translatedText ?? null,
    reviewerProfilePhotoUrl: snippet?.reviewerProfilePhotoUrl ?? null,
    // The review's own page on Google is provider content too: it goes with
    // the words, so an ineligible source offers no link.
    googleReviewUrl: snippet?.googleReviewUrl ?? null,
    reviewContentStatus: result.status,
    // The stars ride with the words. `snippet` is already null unless
    // `result.status === 'available'`, so this expression gives the
    // same eligibility answer the fields around it give — an
    // ineligible source asserts no rating. It is deliberately NOT
    // written onto `item.rating`: the projection NULLs that column on
    // purpose (`inbox-command-store.ts:936`, `:1416`) and the list
    // reads it, so the governed number stays a detail-only field.
    reviewRating: snippet?.rating ?? null,
    feedbackComment: null,
    feedbackRatingValue: null,
  }
}

/** A private-feedback item's detail: no review content, no Google page. */
export function feedbackItemDetail(
  item: InboxItem,
  snippet: FeedbackSnippet | null,
): InboxItemDetail {
  return {
    item: { ...item, reviewerName: null },
    reviewText: null,
    reviewTranslatedText: null,
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    reviewContentStatus: null,
    // Private feedback has no review to rate. Its own number is
    // `feedbackRatingValue` below, from the feedback lookup; leaving
    // `reviewRating` null keeps the two sources from being confused by a
    // consumer that reads one field for both.
    reviewRating: null,
    feedbackComment: snippet?.comment ?? null,
    feedbackRatingValue: snippet?.ratingValue ?? null,
  }
}
