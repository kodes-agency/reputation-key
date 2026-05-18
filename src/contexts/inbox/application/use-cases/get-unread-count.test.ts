import { describe, it, expect } from 'vitest'
import { getUnreadCount } from './get-unread-count'
import { organizationId, userId } from '#/shared/domain/ids'
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

const ORG_ID = organizationId('org-1')
const USER_ID = userId('user-1')

const setup = () => {
  const repo = createInMemoryInboxRepo()

  let counterValue = 0
  let counterShouldThrow = false

  const unreadCounter: UnreadCounterPort = {
    getCount: async () => {
      if (counterShouldThrow) throw new Error('Redis unavailable')
      return counterValue
    },
    setCount: async () => {},
    increment: async () => {},
    decrement: async () => {},
    invalidate: async () => {},
  }

  const deps = { unreadCounter, repo }
  const useCase = getUnreadCount(deps)

  return { useCase, repo, setCounterValue: (v: number) => { counterValue = v }, setCounterThrow: (v: boolean) => { counterShouldThrow = v } }
}

describe('getUnreadCount', () => {
  it('returns counter value when available', async () => {
    const { useCase, setCounterValue } = setup()
    setCounterValue(5)

    const count = await useCase({
      organizationId: ORG_ID,
      userId: USER_ID,
    })

    expect(count).toBe(5)
  })

  it('falls back to repo count when counter throws', async () => {
    const { useCase, repo, setCounterThrow } = setup()
    setCounterThrow(true)

    // Add some 'new' items to the repo
    const now = new Date()
    repo.items.push(
      {
        id: 'ii-1' as any,
        organizationId: ORG_ID,
        propertyId: 'prop-1' as any,
        sourceType: 'review' as SourceType,
        sourceId: 'rev-1' as any,
        status: 'new' as InboxStatus,
        rating: 4,
        sourceDate: now,
        platform: null,
        snippet: null,
        assignedTo: null,
        readAt: null,
        escalatedAt: null,
        addressedAt: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'ii-2' as any,
        organizationId: ORG_ID,
        propertyId: 'prop-1' as any,
        sourceType: 'review' as SourceType,
        sourceId: 'rev-2' as any,
        status: 'new' as InboxStatus,
        rating: 3,
        sourceDate: now,
        platform: null,
        snippet: null,
        assignedTo: null,
        readAt: null,
        escalatedAt: null,
        addressedAt: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    )

    const count = await useCase({
      organizationId: ORG_ID,
      userId: USER_ID,
    })

    expect(count).toBe(2)
  })

  it('falls back to repo count when counter returns 0', async () => {
    const { useCase, repo, setCounterValue } = setup()
    setCounterValue(0)

    const now = new Date()
    repo.items.push({
      id: 'ii-1' as any,
      organizationId: ORG_ID,
      propertyId: 'prop-1' as any,
      sourceType: 'review' as SourceType,
      sourceId: 'rev-1' as any,
      status: 'new' as InboxStatus,
      rating: 4,
      sourceDate: now,
      platform: null,
      snippet: null,
      assignedTo: null,
      readAt: null,
      escalatedAt: null,
      addressedAt: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    })

    const count = await useCase({
      organizationId: ORG_ID,
      userId: USER_ID,
    })

    expect(count).toBe(1)
  })

  it('returns 0 when counter and repo have no items', async () => {
    const { useCase, setCounterValue } = setup()
    setCounterValue(0)

    const count = await useCase({
      organizationId: ORG_ID,
      userId: USER_ID,
    })

    expect(count).toBe(0)
  })
})
