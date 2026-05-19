import { describe, it, expect } from 'vitest'
import { updateInboxStatus } from './update-inbox-status'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import { isInboxError } from '../../domain/errors'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem, InboxStatus, SourceType } from '../../domain/types'
import type { UnreadCounterPort } from '../ports/unread-counter.port'

const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const ORG_ID = organizationId('org-1')
const ITEM_ID = inboxItemId('ii-1')
const USER_ID = userId('user-1')

function seedNew(overrides?: Partial<InboxItem>): InboxItem {
  return {
    id: ITEM_ID,
    organizationId: ORG_ID,
    propertyId: propertyId('prop-1'),
    sourceType: 'review' as SourceType,
    sourceId: reviewId('rev-1'),
    status: 'new' as InboxStatus,
    rating: 4,
    sourceDate: new Date('2026-04-10'),
    platform: 'google',
    snippet: 'Great!',
    assignedTo: null,
    readAt: null,
    escalatedAt: null,
    addressedAt: null,
    archivedAt: null,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...overrides,
  }
}

const setup = () => {
  const repo = createInMemoryInboxRepo()
  const events = createCapturingEventBus()
  const decrements: Array<{ orgId: string; userId: string }> = []
  const unreadCounter: UnreadCounterPort = {
    getCount: async () => 0,
    setCount: async () => {},
    increment: async () => {},
    decrement: async (orgId, uId) => {
      decrements.push({ orgId: orgId as string, userId: uId as string })
    },
    invalidate: async () => {},
  }
  const deps = { repo, events, unreadCounter, clock: () => FIXED_TIME }
  const useCase = updateInboxStatus(deps)
  return { useCase, repo, events, decrements }
}

describe('updateInboxStatus', () => {
  it('transitions new → read successfully', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedNew())

    const updated = await useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      newStatus: 'read',
      userId: USER_ID,
    })

    expect(updated.status).toBe('read')
    expect(updated.readAt).toBe(FIXED_TIME)
  })

  it('throws invalid_transition for invalid transition', async () => {
    const { useCase, repo } = setup()
    repo.items.push(seedNew({ status: 'archived' }))

    await expect(
      useCase({
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        newStatus: 'escalated',
        userId: USER_ID,
      }),
    ).rejects.toSatisfy(
      (e: unknown) => isInboxError(e) && e.code === 'invalid_transition',
    )
  })

  it('throws not_found for missing item', async () => {
    const { useCase } = setup()

    await expect(
      useCase({
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        newStatus: 'read',
        userId: USER_ID,
      }),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'not_found')
  })

  it('decrements unread counter when transitioning new → read', async () => {
    const { useCase, repo, decrements } = setup()
    repo.items.push(seedNew())

    await useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      newStatus: 'read',
      userId: USER_ID,
    })

    expect(decrements).toHaveLength(1)
    expect(decrements[0].orgId).toBe(ORG_ID as string)
    expect(decrements[0].userId).toBe(USER_ID as string)
  })

  it('decrements unread counter for all new → * transitions', async () => {
    const { useCase, repo, decrements } = setup()
    repo.items.push(seedNew())

    await useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      newStatus: 'escalated',
      userId: USER_ID,
    })

    expect(decrements).toHaveLength(1)
  })

  it('emits inbox.status.changed event', async () => {
    const { useCase, repo, events } = setup()
    repo.items.push(seedNew())

    await useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      newStatus: 'read',
      userId: USER_ID,
    })

    const emitted = events.capturedEvents
    expect(emitted).toHaveLength(1)
    expect(emitted[0]._tag).toBe('inbox.status.changed')
  })
})
