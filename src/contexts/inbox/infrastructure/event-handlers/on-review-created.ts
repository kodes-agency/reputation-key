// Inbox context — event handler for review.created
// Creates an inbox item when a new review is ingested.
// BQR-4.2: event is identifier-only; snippet/reviewer re-fetched via lookup.

import type { ReviewCreated } from '#/contexts/review/application/public-api'
import type { CreateInboxItem } from '../../application/use-cases/create-inbox-item'
import type { ReviewLookupPort } from '../../application/ports/review-lookup.port'
import { isInboxError } from '../../domain/errors'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export type OnReviewCreatedDeps = Readonly<{
  createInboxItem: CreateInboxItem
  reviewLookup: ReviewLookupPort
}>

export const onReviewCreated =
  (deps: OnReviewCreatedDeps) =>
  async (event: ReviewCreated): Promise<void> => {
    return trace('event.onReviewCreated', async () => {
      try {
        const snippet = await deps.reviewLookup.getReviewSnippetById(
          event.reviewId,
          event.organizationId,
        )

        await deps.createInboxItem({
          organizationId: event.organizationId,
          propertyId: event.propertyId,
          sourceType: 'review',
          sourceId: event.reviewId,
          rating: event.rating,
          sourceDate: event.occurredAt,
          platform: event.platform,
          snippet: snippet?.text ?? null,
          reviewerName: snippet?.reviewerName ?? null,
        })
      } catch (err) {
        if (isInboxError(err) && err.code === 'already_exists') return
        getLogger().error(
          { err, reviewId: event.reviewId },
          'inbox: failed to handle review.created',
        )
      }
    })
  }
