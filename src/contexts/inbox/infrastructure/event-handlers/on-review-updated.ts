// Inbox context — event handler for review.updated
// Syncs denormalized fields (rating) when a review is updated.

import type { ReviewUpdated } from '#/contexts/review/application/public-api'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import { getLogger } from '#/shared/observability/logger'
import { unbrand } from '#/shared/domain/ids'

export type OnReviewUpdatedDeps = Readonly<{
  repo: InboxRepository
}>

export const onReviewUpdated =
  (deps: OnReviewUpdatedDeps) =>
  async (event: ReviewUpdated): Promise<void> => {
    try {
      const sourceId = unbrand(event.reviewId)
      const item = await deps.repo.findBySource('review', sourceId, event.organizationId)
      if (!item) return

      await deps.repo.syncDenormalizedFields(item.id, item.organizationId, {
        rating: event.rating,
        snippet: event.reviewText ?? undefined,
      })
    } catch (err) {
      getLogger().error(
        { err, reviewId: event.reviewId },
        'inbox: failed to handle review.updated',
      )
    }
  }
