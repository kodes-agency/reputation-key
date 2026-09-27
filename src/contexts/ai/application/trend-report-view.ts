// AI context — the Property Trend read as delivered to a manager.
//
// A supporting review is evidence a manager opens in the Inbox. Stored evidence
// names only the Review; which Inbox Item opens it, and whether this viewer may
// open one, is the Inbox's answer, resolved at the delivery boundary on every
// read. The stored `href` is not delivered: it is not a working route.

import type { InboxItemId, ReviewId } from '#/shared/domain/ids'
import type {
  AiTrendEvidence,
  AiTrendReportRead,
  AiTrendSupportingReview,
} from './ports/ai-output-store.port'

export type AiTrendSupportingReviewView = Readonly<{
  reviewId: ReviewId
  window: AiTrendSupportingReview['window']
  localDate: string
  /** The Inbox Item that opens this Review for the viewer; null when there is none. */
  inboxItemId: InboxItemId | null
}>

export type AiTrendReportView = AiTrendReportRead<AiTrendSupportingReviewView>

/** The Reviews a trend read cites as evidence, in evidence order. */
export function trendSupportingReviewIds(read: AiTrendReportRead): readonly ReviewId[] {
  if (!('evidence' in read) || read.evidence === undefined) return []
  return read.evidence.supportingReviews.map((review) => review.reviewId)
}

function evidenceView(
  evidence: AiTrendEvidence,
  inboxItemIds: ReadonlyMap<ReviewId, InboxItemId>,
): AiTrendEvidence<AiTrendSupportingReviewView> {
  return {
    ...evidence,
    supportingReviews: evidence.supportingReviews.map((review) => ({
      reviewId: review.reviewId,
      window: review.window,
      localDate: review.localDate,
      inboxItemId: inboxItemIds.get(review.reviewId) ?? null,
    })),
  }
}

/**
 * Attach to each supporting review the Inbox Item that opens it. A Review
 * absent from `inboxItemIds` gets null: the viewer has no item to open.
 */
export function withSupportingReviewItems(
  read: AiTrendReportRead,
  inboxItemIds: ReadonlyMap<ReviewId, InboxItemId>,
): AiTrendReportView {
  switch (read.status) {
    case 'disabled':
    case 'preparing':
      return read
    case 'updating': {
      const { evidence, ...rest } = read
      return evidence === undefined
        ? rest
        : { ...rest, evidence: evidenceView(evidence, inboxItemIds) }
    }
    default:
      return { ...read, evidence: evidenceView(read.evidence, inboxItemIds) }
  }
}
