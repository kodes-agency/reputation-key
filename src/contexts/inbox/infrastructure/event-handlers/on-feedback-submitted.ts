// Inbox context — event handler for feedback.submitted
// Creates an inbox item when guest feedback is submitted.

import type { GuestFeedbackSubmitted } from '#/contexts/guest/application/public-api'
import type { CreateInboxItemUseCase } from '../../application/use-cases/create-inbox-item'
import { isInboxError } from '../../domain/errors'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export type OnFeedbackSubmittedDeps = Readonly<{
  createInboxItem: CreateInboxItemUseCase
}>

export const onFeedbackSubmitted =
  (deps: OnFeedbackSubmittedDeps) =>
  async (event: GuestFeedbackSubmitted): Promise<void> => {
    return trace('event.onFeedbackSubmitted', async () => {
      try {
        await deps.createInboxItem({
          organizationId: event.organizationId,
          propertyId: event.propertyId,
          sourceType: 'feedback',
          sourceId: event.feedbackId,
          rating: null,
          sourceDate: event.occurredAt,
          platform: null,
          snippet: null,
          reviewerName: null,
        })
      } catch (err) {
        if (isInboxError(err) && err.code === 'already_exists') return
        getLogger().error(
          { err, feedbackId: event.feedbackId },
          'inbox: failed to handle feedback.submitted',
        )
      }
    })
  }
