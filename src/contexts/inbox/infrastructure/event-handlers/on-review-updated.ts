// Inbox context — event handler for review.updated
// Syncs denormalized fields (rating) when a review is updated.

import type { EventBus } from '#/shared/events/event-bus'
import type { ReviewUpdated } from '#/contexts/review/domain/events'
import type { InboxRepository } from '../../application/ports/inbox.repository'

export type OnReviewUpdatedDeps = Readonly<{
  events: EventBus
  repo: InboxRepository
}>

export const onReviewUpdated =
  (deps: OnReviewUpdatedDeps) =>
  async (event: ReviewUpdated): Promise<void> => {
    try {
      // Find the inbox item by source (review)
      const item = await deps.repo.findBySource('review', event.reviewId as string, event.organizationId)
      if (!item) return // no inbox item for this review — nothing to sync

      // Sync the denormalized rating field
      await deps.repo.syncDenormalizedFields(item.id, item.organizationId, {
        rating: event.rating,
      })
    } catch (err) {
      const { getLogger } = await import('#/shared/observability/logger')
      getLogger().error({ err, reviewId: event.reviewId }, 'inbox: failed to handle review.updated')
    }
  }
