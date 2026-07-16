// Inbox context — event handler for review.updated
// Syncs denormalized fields when a review is updated.
// BQR-4.2: event is identifier-only; content re-fetched via lookup.

import type { ReviewUpdated } from '#/contexts/review/application/public-api'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import type { ReviewLookupPort } from '../../application/ports/review-lookup.port'
import { getLogger } from '#/shared/observability/logger'
import { unbrand } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'

export type OnReviewUpdatedDeps = Readonly<{
  repo: InboxRepository
  reviewLookup: ReviewLookupPort
}>

export const onReviewUpdated =
  (deps: OnReviewUpdatedDeps) =>
  async (event: ReviewUpdated): Promise<void> => {
    return trace('event.onReviewUpdated', async () => {
      try {
        const sourceId = unbrand(event.reviewId)
        const item = await deps.repo.findBySource(
          'review',
          sourceId,
          event.organizationId,
        )
        if (!item) return

        const snippet = await deps.reviewLookup.getReviewSnippetById(
          event.reviewId,
          event.organizationId,
        )

        await deps.repo.syncDenormalizedFields(item.id, item.organizationId, {
          rating: event.rating,
          snippet: snippet?.text ?? undefined,
          reviewerName: snippet?.reviewerName ?? null,
        })
      } catch (err) {
        getLogger().error(
          { err, reviewId: event.reviewId },
          'inbox: failed to handle review.updated',
        )
      }
    })
  }
