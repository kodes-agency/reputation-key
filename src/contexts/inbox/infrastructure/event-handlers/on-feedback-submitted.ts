// Inbox context — event handler for feedback.submitted
// Creates an inbox item when guest feedback is submitted.
// BQC-1.2: metadata only — guest rating/comment resolve live at read time.

import type { GuestFeedbackSubmitted } from '#/contexts/guest/application/public-api'
import type { CreateInboxItem } from '../../application/use-cases/create-inbox-item'
import { isInboxError } from '../../domain/errors'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export type OnFeedbackSubmittedDeps = Readonly<{
  createInboxItem: CreateInboxItem
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
          sourceDate: event.occurredAt,
          platform: null,
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
