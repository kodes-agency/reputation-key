// Activity context — event handler tests
// Tests that each handler constructs the correct InsertActivityLogInput.
// Pure unit tests with mock queue — no DB needed.

import { describe, it, expect, vi } from 'vitest'
import type { Queue } from 'bullmq'
import {
  organizationId,
  propertyId,
  inboxItemId,
  userId,
  reviewId,
  replyId,
} from '#/shared/domain/ids'

const ORG = organizationId('org-1')
const PROP = propertyId('00000000-0000-4000-8000-000000000001')
const INBOX_ITEM = inboxItemId('00000000-0000-4000-8000-000000000010')
const USER = userId('00000000-0000-4000-8000-000000000020')
const REVIEW = reviewId('00000000-0000-4000-8000-000000000030')
const REPLY = replyId('00000000-0000-4000-8000-000000000040')

function createMockDeps() {
  const calls: { name: string; data: unknown }[] = []
  const queue = {
    add: vi.fn(async (name: string, data: unknown) => {
      calls.push({ name, data })
    }),
  } as unknown as Queue
  const inboxItemLookup = {
    findBySourceId: vi.fn(async () => INBOX_ITEM as string),
  }
  return { queue, calls, inboxItemLookup }
}

describe('activity event handlers', () => {
  describe('onInboxItemCreated', () => {
    it('maps to created/inbox_item with source type detail', async () => {
      const { onInboxItemCreated } = await import('./on-inbox-item-created')
      const { queue, calls } = createMockDeps()
      const handler = onInboxItemCreated({ queue })

      await handler({
        _tag: 'inbox.inbox_item.created',
        eventId: 'evt-1',
        inboxItemId: INBOX_ITEM,
        organizationId: ORG,
        propertyId: PROP,
        sourceType: 'review',
        sourceId: REVIEW,
        userId: USER,
        source: 'web',
        occurredAt: new Date(),
        correlationId: null,
      })

      expect(calls).toHaveLength(1)
      expect(calls[0]!.name).toBe('insert-activity-log')
      const data = calls[0]!.data as {
        action: string
        resourceType: string
        resourceId: string
      }
      expect(data.action).toBe('created')
      expect(data.resourceType).toBe('inbox_item')
      expect(data.resourceId).toBe(INBOX_ITEM as string)
    })
  })

  describe('onInboxItemEscalated', () => {
    it('maps to escalated/inbox_item', async () => {
      const { onInboxItemEscalated } = await import('./on-inbox-item-escalated')
      const { queue, calls } = createMockDeps()
      const handler = onInboxItemEscalated({ queue })

      await handler({
        _tag: 'inbox.inbox_item.escalated',
        eventId: 'evt-2',
        inboxItemId: INBOX_ITEM,
        organizationId: ORG,
        propertyId: PROP,
        userId: USER,
        oldStatus: 'new',
        source: 'web',
        occurredAt: new Date(),
        correlationId: null,
      })

      const data = calls[0]!.data as { action: string; resourceType: string }
      expect(data.action).toBe('escalated')
      expect(data.resourceType).toBe('inbox_item')
    })
  })

  describe('onInboxItemAssigned', () => {
    it('maps to assigned/inbox_item with assignee in payload', async () => {
      const { onInboxItemAssigned } = await import('./on-inbox-item-assigned')
      const { queue, calls } = createMockDeps()
      const handler = onInboxItemAssigned({ queue })

      const ASSIGNEE = userId('00000000-0000-4000-8000-000000000050')
      await handler({
        _tag: 'inbox.inbox_item.assigned',
        eventId: 'evt-3',
        inboxItemId: INBOX_ITEM,
        organizationId: ORG,
        propertyId: PROP,
        userId: USER,
        assignedTo: ASSIGNEE,
        source: 'web',
        occurredAt: new Date(),
        correlationId: null,
      })

      const data = calls[0]!.data as { action: string; payload: { to: string } }
      expect(data.action).toBe('assigned')
      expect(data.payload.to).toBe(ASSIGNEE as string)
    })
  })

  describe('onReplySubmitted', () => {
    it('maps to submitted/reply', async () => {
      const { onReplySubmitted } = await import('./on-reply-submitted')
      const { queue, calls, inboxItemLookup } = createMockDeps()
      const handler = onReplySubmitted({ queue, inboxItemLookup })

      await handler({
        _tag: 'review.reply.submitted',
        eventId: 'evt-4',
        replyId: REPLY,
        reviewId: REVIEW,
        propertyId: PROP,
        organizationId: ORG,
        userId: USER,
        source: 'web',
        occurredAt: new Date(),
        correlationId: null,
      })

      const data = calls[0]!.data as { action: string; resourceType: string }
      expect(data.resourceType).toBe('reply')
    })
  })

  describe('onReplyApproved', () => {
    it('maps to approved/reply', async () => {
      const { onReplyApproved } = await import('./on-reply-approved')
      const { queue, calls, inboxItemLookup } = createMockDeps()
      const handler = onReplyApproved({ queue, inboxItemLookup })

      await handler({
        _tag: 'review.reply.approved',
        eventId: 'evt-5',
        replyId: REPLY,
        reviewId: REVIEW,
        propertyId: PROP,
        organizationId: ORG,
        userId: USER,
        authorId: USER,
        source: 'web',
        occurredAt: new Date(),
        correlationId: null,
      })

      const data = calls[0]!.data as { action: string; resourceType: string }
      expect(data.action).toBe('approved')
      expect(data.resourceType).toBe('reply')
    })
  })

  describe('onReplyPublished', () => {
    it('maps to published/reply', async () => {
      const { onReplyPublished } = await import('./on-reply-published')
      const { queue, calls, inboxItemLookup } = createMockDeps()
      const handler = onReplyPublished({ queue, inboxItemLookup })

      await handler({
        _tag: 'review.reply.published',
        eventId: 'evt-6',
        replyId: REPLY,
        reviewId: REVIEW,
        propertyId: PROP,
        organizationId: ORG,
        userId: USER,
        authorId: USER,
        source: 'web',
        occurredAt: new Date(),
        correlationId: null,
      })

      const data = calls[0]!.data as { action: string; resourceType: string }
      expect(data.action).toBe('published')
      expect(data.resourceType).toBe('reply')
    })
  })

  describe('onReplyRejected', () => {
    it('maps to rejected/reply with reason in detail', async () => {
      const { onReplyRejected } = await import('./on-reply-rejected')
      const { queue, calls, inboxItemLookup } = createMockDeps()
      const handler = onReplyRejected({ queue, inboxItemLookup })

      await handler({
        _tag: 'review.reply.rejected',
        eventId: 'evt-7',
        replyId: REPLY,
        reviewId: REVIEW,
        propertyId: PROP,
        organizationId: ORG,
        userId: USER,
        authorId: USER,
        source: 'web',
        reason: 'Not appropriate',
        occurredAt: new Date(),
        correlationId: null,
      })

      const data = calls[0]!.data as { action: string; payload: { detail: string } }
      expect(data.action).toBe('rejected')
      expect(data.payload.detail).toBe('Not appropriate')
    })
  })
})
