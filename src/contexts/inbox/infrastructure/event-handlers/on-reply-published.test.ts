// Inbox context — on-reply-published event handler tests

import { describe, it, expect, vi } from 'vitest'
import { onReplyPublished } from './on-reply-published'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import type { NewCounterPort } from '../../application/ports/new-counter.port'
import type { InboxItem } from '../../application/public-api'
import type { ReviewReplyPublished } from '#/contexts/review/application/public-api'
import type { EventBus } from '#/shared/events/event-bus'
import {
  inboxItemId,
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
const INBOX_ID = inboxItemId('inbox-1')
const NOW = new Date('2025-06-01T12:00:00Z')

function makeInboxItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: INBOX_ID,
    organizationId: ORG_ID,
    propertyId: PROP_ID,
    sourceType: 'review',
    sourceId: REVIEW_ID,
    platform: 'google',
    snippet: 'Great stay',
    rating: 5,
    status: 'new',
    assignedTo: null,
    reviewerName: null,
    propertyName: null,
    sourceDate: NOW,
    readAt: null,
    escalatedAt: null,
    addressedAt: null,
    archivedAt: null,
    firstReplySubmittedAt: null,
    firstReplyPublishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

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

function makeDeps(overrides: { repo: Partial<InboxRepository> }) {
  return {
    repo: {
      findBySource: vi.fn(async () => null),
      updateStatus: vi.fn(async () => {}),
      ...overrides.repo,
    } as unknown as InboxRepository,
    events: {
      on: vi.fn(),
      emit: vi.fn(async () => {}),
      clear: vi.fn(),
    } as unknown as EventBus,
    newCounter: {
      getCount: vi.fn(async () => 0),
      setCount: vi.fn(async () => {}),
      increment: vi.fn(async () => {}),
      decrement: vi.fn(async () => {}),
      invalidate: vi.fn(async () => {}),
    } as unknown as NewCounterPort,
  }
}

describe('onReplyPublished', () => {
  it('transitions inbox item to addressed', async () => {
    const item = makeInboxItem({ status: 'new' })
    const deps = makeDeps({ repo: { findBySource: vi.fn(async () => item) } })

    await onReplyPublished(deps)(mockEvent)

    expect(deps.repo.updateStatus).toHaveBeenCalledWith(
      INBOX_ID,
      ORG_ID,
      'addressed',
      { addressedAt: NOW, firstReplyPublishedAt: NOW },
      NOW,
    )
  })

  it('decrements new counter when item was new', async () => {
    const item = makeInboxItem({ status: 'new' })
    const deps = makeDeps({ repo: { findBySource: vi.fn(async () => item) } })

    await onReplyPublished(deps)(mockEvent)

    expect(deps.newCounter.decrement).toHaveBeenCalledWith(ORG_ID)
  })

  it('does not decrement counter when item was read', async () => {
    const item = makeInboxItem({ status: 'read' })
    const deps = makeDeps({ repo: { findBySource: vi.fn(async () => item) } })

    await onReplyPublished(deps)(mockEvent)

    expect(deps.newCounter.decrement).not.toHaveBeenCalled()
  })

  it('emits inbox.status.changed event', async () => {
    const item = makeInboxItem({ status: 'new' })
    const deps = makeDeps({ repo: { findBySource: vi.fn(async () => item) } })

    await onReplyPublished(deps)(mockEvent)

    expect(deps.events.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        _tag: 'inbox.inbox_item.status_changed',
        oldStatus: 'new',
        newStatus: 'addressed',
      }),
    )
  })

  it('skips if no inbox item found', async () => {
    const deps = makeDeps({ repo: { findBySource: vi.fn(async () => null) } })

    await onReplyPublished(deps)(mockEvent)

    expect(deps.repo.updateStatus).not.toHaveBeenCalled()
  })

  it('skips when item is already addressed AND firstReplyPublishedAt is already stamped', async () => {
    const item = makeInboxItem({
      status: 'addressed',
      firstReplyPublishedAt: new Date('2025-05-01T00:00:00Z'),
    })
    const deps = makeDeps({ repo: { findBySource: vi.fn(async () => item) } })

    await onReplyPublished(deps)(mockEvent)

    // Nothing to persist — fully handled already.
    expect(deps.repo.updateStatus).not.toHaveBeenCalled()
    expect(deps.events.emit).not.toHaveBeenCalled()
  })

  it('stamps firstReplyPublishedAt on an already-addressed item when the milestone is missing', async () => {
    // addressed→addressed is not a valid transition, but a published reply
    // must still record its milestone (the bug this test pins down).
    const item = makeInboxItem({ status: 'addressed', firstReplyPublishedAt: null })
    const deps = makeDeps({ repo: { findBySource: vi.fn(async () => item) } })

    await onReplyPublished(deps)(mockEvent)

    expect(deps.repo.updateStatus).toHaveBeenCalledWith(
      INBOX_ID,
      ORG_ID,
      'addressed', // status unchanged (no valid transition)
      { firstReplyPublishedAt: NOW }, // milestone stamped
      NOW,
    )
    // No status_changed event for a no-op transition.
    expect(deps.events.emit).not.toHaveBeenCalled()
  })

  it('stamps firstReplyPublishedAt on an archived item when the milestone is missing', async () => {
    // archived→addressed is not a valid transition; milestone still stamps.
    const item = makeInboxItem({ status: 'archived', firstReplyPublishedAt: null })
    const deps = makeDeps({ repo: { findBySource: vi.fn(async () => item) } })

    await onReplyPublished(deps)(mockEvent)

    expect(deps.repo.updateStatus).toHaveBeenCalledWith(
      INBOX_ID,
      ORG_ID,
      'archived', // status unchanged
      { firstReplyPublishedAt: NOW },
      NOW,
    )
    expect(deps.events.emit).not.toHaveBeenCalled()
  })

  it('skips when item is archived AND firstReplyPublishedAt is already stamped', async () => {
    const item = makeInboxItem({
      status: 'archived',
      firstReplyPublishedAt: new Date('2025-05-01T00:00:00Z'),
    })
    const deps = makeDeps({ repo: { findBySource: vi.fn(async () => item) } })

    await onReplyPublished(deps)(mockEvent)

    expect(deps.repo.updateStatus).not.toHaveBeenCalled()
    expect(deps.events.emit).not.toHaveBeenCalled()
  })

  it('does not overwrite an existing firstReplyPublishedAt when transitioning', async () => {
    const existing = new Date('2025-05-01T00:00:00Z')
    const item = makeInboxItem({ status: 'new', firstReplyPublishedAt: existing })
    const deps = makeDeps({ repo: { findBySource: vi.fn(async () => item) } })

    await onReplyPublished(deps)(mockEvent)

    // Transition new→addressed still happens; milestone is NOT restamped.
    expect(deps.repo.updateStatus).toHaveBeenCalledWith(
      INBOX_ID,
      ORG_ID,
      'addressed',
      { addressedAt: NOW },
      NOW,
    )
  })

  it('does not throw on repo error', async () => {
    const deps = makeDeps({
      repo: {
        findBySource: vi.fn(async () => {
          throw new Error('DB down')
        }),
      },
    })

    await expect(onReplyPublished(deps)(mockEvent)).resolves.toBeUndefined()
  })
})
