// Inbox context — on-reply-published event handler tests

import { describe, it, expect, vi } from 'vitest'
import { onReplyPublished } from './on-reply-published'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import type { ReviewReplyPublished } from '#/contexts/review/application/public-api'
import type { EventBus } from '#/shared/events/event-bus'
import {
  organizationId,
  reviewId,
  propertyId,
  replyId,
  userId,
} from '#/shared/domain/ids'

const ORG_ID = organizationId('org-1')
const REVIEW_ID = reviewId('rev-1')
const REPLY_ID = replyId('reply-1')
const PROP_ID = propertyId('prop-1')
const NOW = new Date('2025-06-01T12:00:00Z')

const mockEvent: ReviewReplyPublished = {
  _tag: 'review.reply.published',
  eventId: 'test-event-id',
  correlationId: null,
  replyId: REPLY_ID,
  reviewId: REVIEW_ID,
  propertyId: PROP_ID,
  organizationId: ORG_ID,
  userId: userId('user-1'),
  authorId: userId('author-1'),
  source: 'web',
  occurredAt: NOW,
}

function makeDeps() {
  return {
    repo: {
      findBySource: vi.fn(async () => null),
      updateStatus: vi.fn(async () => {}),
    } as unknown as InboxRepository,
    events: {
      on: vi.fn(),
      emit: vi.fn(async () => {}),
      clear: vi.fn(),
    } as unknown as EventBus,
  }
}

describe('onReplyPublished', () => {
  it('cannot mutate Inbox because publication is not provider evidence', async () => {
    const deps = makeDeps()

    await expect(onReplyPublished(deps)(mockEvent)).resolves.toBeUndefined()
    expect(deps.repo.findBySource).not.toHaveBeenCalled()
    expect(deps.repo.updateStatus).not.toHaveBeenCalled()
    expect(deps.events.emit).not.toHaveBeenCalled()
  })
})
