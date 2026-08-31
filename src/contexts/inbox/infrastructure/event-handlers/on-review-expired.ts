// Inbox context — event handler for review.expired
// Legacy compatibility only: scrubs any restored provider-controlled Inbox
// projection values. The event has no source epoch/revision, so it must never
// decide the status of possibly re-observed current work.
//
// Expand-phase dual path (the durable dispatcher is off in production): the
// durable inbox.on-review-expired consumer performs the same projection via
// the command store; this bus handler keeps the legacy in-process behavior
// (bus emit only — it never received an outboxRepo).

import type { ReviewExpired } from '#/contexts/review/application/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import { unbrand } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'

export type OnReviewExpiredDeps = Readonly<{
  repo: InboxRepository
  logger: LoggerPort
}>

export const onReviewExpired =
  (deps: OnReviewExpiredDeps) =>
  async (event: ReviewExpired): Promise<void> => {
    return trace('event.onReviewExpired', async () => {
      try {
        const sourceId = unbrand(event.reviewId)
        const item = await deps.repo.findBySource(
          'review',
          sourceId,
          event.organizationId,
        )
        if (!item) return

        await deps.repo.clearReviewSourceContent(
          item.id,
          item.organizationId,
          event.occurredAt,
        )
      } catch (err) {
        deps.logger.error({ err }, 'inbox: failed to handle review.expired')
      }
    })
  }
