import { describe, it, expect } from 'vitest'
import { createInboxItemUseCase } from './create-inbox-item'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { isInboxError } from '../../domain/errors'
import { inboxItemId, organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type { InboxItem, SourceType } from '../../domain/types'
import type { InboxRepository } from '../ports/inbox.repository'

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
      return {
        items: sliced,
        nextCursor: last ? { sourceDate: last.sourceDate, id: last.id } : null,
      }
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

const FIXED_ID = inboxItemId('ii-1')
const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const ORG_ID = organizationId('org-1')
const PROP_ID = propertyId('prop-1')

const setup = () => {
  const repo = createInMemoryInboxRepo()
  const events = createCapturingEventBus()
  const deps = {
    repo,
    events,
    idGen: () => FIXED_ID,
    clock: () => FIXED_TIME,
  }
  const useCase = createInboxItemUseCase(deps)
  return { useCase, repo, events }
}

describe('createInboxItem', () => {
  it('creates an inbox item and persists it', async () => {
    const { useCase, repo } = setup()

    const item = await useCase({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceType: 'review' as SourceType,
      sourceId: reviewId('rev-1'),
      rating: 4,
      sourceDate: new Date('2026-04-10'),
      platform: 'google',
      snippet: 'Great stay!',
    })

    expect(item.id).toBe(FIXED_ID)
    expect(item.status).toBe('new')
    expect(item.rating).toBe(4)
    expect(item.platform).toBe('google')
    expect(item.snippet).toBe('Great stay!')
    expect(repo.items).toHaveLength(1)
  })

  it('emits inbox.item.created event', async () => {
    const { useCase, events } = setup()

    await useCase({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceType: 'review' as SourceType,
      sourceId: reviewId('rev-1'),
      rating: 5,
      sourceDate: new Date('2026-04-10'),
      platform: null,
      snippet: null,
    })

    const emitted = events.capturedEvents
    expect(emitted).toHaveLength(1)
    expect(emitted[0]._tag).toBe('inbox.item.created')
  })

  it('throws already_exists for duplicate source', async () => {
    const { useCase } = setup()

    const input = {
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceType: 'review' as SourceType,
      sourceId: reviewId('rev-1'),
      rating: 3,
      sourceDate: new Date('2026-04-10'),
      platform: 'google',
      snippet: 'OK',
    }

    await useCase(input)

    await expect(useCase(input)).rejects.toSatisfy(
      (e: unknown) => isInboxError(e) && e.code === 'already_exists',
    )
  })
})
