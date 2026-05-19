// Inbox context — event handler for feedback.submitted
// Creates an inbox item when guest feedback is submitted.

import type { EventBus } from '#/shared/events/event-bus'
import type { FeedbackSubmitted } from '#/contexts/guest/domain/events'
import type { CreateInboxItemUseCase } from '../../application/use-cases/create-inbox-item'
import { isInboxError } from '../../domain/errors'
import { getLogger } from '#/shared/observability/logger'

export type OnFeedbackSubmittedDeps = Readonly<{
  events: EventBus
  createInboxItem: CreateInboxItemUseCase
}>

export const onFeedbackSubmitted =
  (deps: OnFeedbackSubmittedDeps) =>
  async (event: FeedbackSubmitted): Promise<void> => {
    try {
      await deps.createInboxItem({
        organizationId: event.organizationId,
        propertyId: event.propertyId,
        sourceType: 'feedback',
        sourceId: event.feedbackId,
        rating: null, // feedback rating resolved via separate query (deferred)
        sourceDate: event.occurredAt,
        platform: null, // feedback comes from portal, not external platform
        snippet: null,
      })
    } catch (err) {
      // If already_exists, ignore — feedback may have already been ingested
      if (isInboxError(err) && err.code === 'already_exists') return
      getLogger().error(
        { err, feedbackId: event.feedbackId },
        'inbox: failed to handle feedback.submitted',
      )
    }
  }
