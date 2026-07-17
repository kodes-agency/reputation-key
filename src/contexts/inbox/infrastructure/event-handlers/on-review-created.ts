// Inbox context — event handler for review.created
// Creates an inbox item when a new review is ingested.
// BQC-1.2: metadata only — raw content is never copied onto inbox items;
// reads resolve live via the eligibility-enforcing review lookup.

import type { ReviewCreated } from '#/contexts/review/application/public-api'
import type { CreateInboxItem } from '../../application/use-cases/create-inbox-item'
import { isInboxError } from '../../domain/errors'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export type OnReviewCreatedDeps = Readonly<{
  createInboxItem: CreateInboxItem
}>

export const onReviewCreated =
  (deps: OnReviewCreatedDeps) =>
  async (event: ReviewCreated): Promise<void> => {
    return trace('event.onReviewCreated', async () => {
      try {
        await deps.createInboxItem({
          organizationId: event.organizationId,
          propertyId: event.propertyId,
          sourceType: 'review',
          sourceId: event.reviewId,
          sourceDate: event.occurredAt,
          platform: event.platform,
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
