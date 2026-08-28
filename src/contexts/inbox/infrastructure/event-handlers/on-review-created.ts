// Inbox context — event handler for review.created
// Creates an inbox item when a new review is ingested.
// BQC-1.2: metadata only — raw content is never copied onto inbox items;
// reads resolve live via the eligibility-enforcing review lookup.

import type { ReviewCreated } from '#/contexts/review/application/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { CreateInboxItem } from '../../application/use-cases/create-inbox-item'
import { isInboxError } from '../../domain/errors'
import { trace } from '#/shared/observability/trace'

export type OnReviewCreatedDeps = Readonly<{
  createInboxItem: CreateInboxItem
  logger: LoggerPort
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
          materialReviewRevision: event.sourceRevision,
        })
      } catch (err) {
        if (isInboxError(err) && err.code === 'already_exists') return
        deps.logger.error({ err }, 'inbox: failed to handle review.created')
      }
    })
  }
