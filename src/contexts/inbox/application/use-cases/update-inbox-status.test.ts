import { describe, it, expect } from 'vitest'
import { updateInboxStatus } from './update-inbox-status'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { isInboxError } from '../../domain/errors'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem, InboxStatus, SourceType } from '../../domain/types'
import type { InboxRepository } from '../ports/inbox.repository'
import type { UnreadCounterPort } from '../ports/unread-counter.port'

// ── In-memory repo ──────────────────────────────────────────────────
function createInMemoryInboxRepo(): InboxRepository & { items: InboxItem[] } {
  const items: InboxItem[] = []
  const repo: InboxRepository = {
    findById: async (id, orgId) => items.find(i => i.id === id && i.organizationId === orgId) ?? null,
    findBySource: async (sourceType, sourceId, orgId) =>
      items.find(i => i.sourceType === sourceType && i.sourceId === sourceId && i.organizationId === orgId) ?? null,
    findFilteredPaginated: async (filters, orgId, cursor, limit = 50) => {
      let filtered = items.filter(i => i.organizationId === orgId)
      if (filters.status) filtered = filtered.filter(i => i.status === filters.status)
      if (filters.propertyId) filtered = filtered.filter(i => i.propertyId === filters.propertyId)
      if (filters.sourceType) filtered = filtered.filter(i => i.sourceType === filters.sourceType)
      filtered.sort((a, b) => b.sourceDate.getTime() - a.sourceDate.getTime() || (b.id as string).localeCompare(a.id as string))
      if (cursor) {
        const idx = filtered.findIndex(i => i.sourceDate.getTime() === cursor.sourceDate.getTime() && i.id === cursor.id)
        filtered = idx >= 0 ? filtered.slice(idx + 1) : []
      }
      const sliced = filtered.slice(0, limit)
      const last = sliced[sliced.length - 1]
      return { items: sliced, nextCursor: last ? { sourceDate: last.sourceDate, id: last.id } : null }
    },
    create: async (item) => { items.push(item); return item },
    updateStatus: async (id, orgId, status, timestampFields) => {
      const item = items.find(i => i.id === id && i.organizationId === orgId)
      if (!item) throw new Error('not found')
      const idx = items.indexOf(item)
      items[idx] = { ...item, status, updatedAt: new Date(), ...timestampFields }
      return items[idx]
    },
    bulkUpdateStatus: async (ids, orgId, status, timestampFields) => {
      let updated = 0
      for (const id of ids) {
        const item = items.find(i => i.id === id && i.organizationId === orgId)
        if (item) {
          const idx = items.indexOf(item)
          items[idx] = { ...item, status, updatedAt: new Date(), ...timestampFields }
          updated++
        }
      }
      return { updated }
    },
    updateAssignment: async (id, orgId, assignedTo) => {
      const item = items.find(i => i.id === id && i.organizationId === orgId)
      if (!item) throw new Error('not found')
      const idx = items.indexOf(item)
      items[idx] = { ...item, assignedTo, updatedAt: new Date() }
      return items[idx]
    },
    countByStatus: async (orgId, status) => items.filter(i => i.organizationId === orgId && i.status === status).length,
    syncDenormalizedFields: async () => {},
    findDetailById: async (id, orgId) => {
      const item = items.find(i => i.id === id && i.organizationId === orgId)
      if (!item) return null
      return { item, reviewerName: null, reviewText: null, reviewerProfilePhotoUrl: null, feedbackComment: null, feedbackRatingValue: null }
    },
  }
  return { ...repo, items }
}

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
    decrement: async (orgId, uId) => { decrements.push({ orgId: orgId as string, userId: uId as string }) },
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
    ).rejects.toSatisfy(
      (e: unknown) => isInboxError(e) && e.code === 'not_found',
    )
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

  it('does not decrement unread counter for non-new→read transitions', async () => {
    const { useCase, repo, decrements } = setup()
    repo.items.push(seedNew())

    await useCase({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      newStatus: 'escalated',
      userId: USER_ID,
    })

    expect(decrements).toHaveLength(0)
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
