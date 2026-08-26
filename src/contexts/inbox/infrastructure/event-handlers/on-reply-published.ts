// Quarantined compatibility handler for review.reply.published.
//
// This handler is deliberately not registered. Publication is an internal
// workflow fact, not provider evidence, so it must never mutate Inbox state.
// The durable review.reply.observed path re-reads the exact current Google
// observation head before it closes or reopens a Handling Cycle.

import type { ReviewReplyPublished } from '#/contexts/review/application/public-api'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import type { EventBus } from '#/shared/events/event-bus'

export type OnReplyPublishedDeps = Readonly<{
  repo: InboxRepository
  events: EventBus
}>

export const onReplyPublished =
  (_deps: OnReplyPublishedDeps) =>
  async (_event: ReviewReplyPublished): Promise<void> => {}
