// Inbox context — event handler for review.created
// Creates an inbox item when a new review is ingested.

import type { EventBus } from '#/shared/events/event-bus'
import type { ReviewCreated } from '#/contexts/review/domain/events'
import type { CreateInboxItemUseCase } from '../../application/use-cases/create-inbox-item'
import { isInboxError } from '../../domain/errors'
import { getLogger } from '#/shared/observability/logger'

export type OnReviewCreatedDeps = Readonly<{
  events: EventBus
  createInboxItem: CreateInboxItemUseCase
}>

export const onReviewCreated =
  (deps: OnReviewCreatedDeps) =>
  async (event: ReviewCreated): Promise<void> => {
    try {
      await deps.createInboxItem({
        organizationId: event.organizationId,
        propertyId: event.propertyId,
        sourceType: 'review',
        sourceId: event.reviewId,
        rating: event.rating,
        sourceDate: event.occurredAt,
        platform: event.platform,
        snippet: null, // reviews don't have snippet at creation time
      })
    } catch (err) {
      // If already_exists, ignore — review may have already been ingested
      if (isInboxError(err) && err.code === 'already_exists') return
      getLogger().error(
        { err, reviewId: event.reviewId },
        'inbox: failed to handle review.created',
      )
    }
  }
