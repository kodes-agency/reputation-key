// Inbox context — on-reply-published event handler tests

import { describe, it, expect, vi } from 'vitest'
import { onReplyPublished } from './on-reply-published'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import type { InboxItem } from '../../application/public-api'
import type { ReplyPublished } from '#/contexts/review/application/public-api'
import {
  inboxItemId,
  organizationId,
  reviewId,
  propertyId,
  replyId,
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const mockEvent: ReplyPublished = {
  _tag: 'reply.published',
  replyId: REPLY_ID,
  reviewId: REVIEW_ID,
  propertyId: PROP_ID,
  organizationId: ORG_ID,
  occurredAt: NOW,
}

describe('onReplyPublished', () => {
  it('transitions inbox item to addressed', async () => {
    const item = makeInboxItem({ status: 'new' })
    const repo = {
      findBySource: vi.fn(async () => item),
      updateStatus: vi.fn(async () => {}),
    } as unknown as InboxRepository

    await onReplyPublished({ repo })(mockEvent)

    expect(repo.updateStatus).toHaveBeenCalledWith(
      INBOX_ID,
      ORG_ID,
      'addressed',
      {
        addressedAt: NOW,
      },
      NOW,
    )
  })

  it('skips if no inbox item found', async () => {
    const repo = {
      findBySource: vi.fn(async () => null),
      updateStatus: vi.fn(async () => {}),
    } as unknown as InboxRepository

    await onReplyPublished({ repo })(mockEvent)

    expect(repo.updateStatus).not.toHaveBeenCalled()
  })

  it('skips if inbox item already addressed', async () => {
    const item = makeInboxItem({ status: 'addressed' })
    const repo = {
      findBySource: vi.fn(async () => item),
      updateStatus: vi.fn(async () => {}),
    } as unknown as InboxRepository

    await onReplyPublished({ repo })(mockEvent)

    expect(repo.updateStatus).not.toHaveBeenCalled()
  })

  it('skips if inbox item is archived', async () => {
    const item = makeInboxItem({ status: 'archived' })
    const repo = {
      findBySource: vi.fn(async () => item),
      updateStatus: vi.fn(async () => {}),
    } as unknown as InboxRepository

    await onReplyPublished({ repo })(mockEvent)

    expect(repo.updateStatus).not.toHaveBeenCalled()
  })

  it('does not throw on repo error', async () => {
    const repo = {
      findBySource: vi.fn(async () => {
        throw new Error('DB down')
      }),
      updateStatus: vi.fn(async () => {}),
    } as unknown as InboxRepository

    await expect(onReplyPublished({ repo })(mockEvent)).resolves.toBeUndefined()
  })
})
