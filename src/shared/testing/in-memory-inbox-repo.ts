// Shared testing utility — in-memory inbox repository for unit tests
import type { InboxRepository } from '#/contexts/inbox/application/ports/inbox.repository'
import type { InboxItem } from '#/contexts/inbox/domain/types'

export function createInMemoryInboxRepo(): InboxRepository & { items: InboxItem[] } {
  const items: InboxItem[] = []
  const repo: InboxRepository = {
    findById: async (id, orgId) =>
      items.find((i) => i.id === id && i.organizationId === orgId) ?? null,
    findBySource: async (sourceType, sourceId, orgId) =>
      items.find(
        (i) =>
          i.sourceType === sourceType &&
          i.sourceId === sourceId &&
          i.organizationId === orgId,
      ) ?? null,
    findFilteredPaginated: async (filters, orgId, cursor, limit = 50) => {
      let filtered = items.filter((i) => i.organizationId === orgId)
      if (filters.status) filtered = filtered.filter((i) => i.status === filters.status)
      if (filters.propertyId)
        filtered = filtered.filter((i) => i.propertyId === filters.propertyId)
      if (filters.sourceType)
        filtered = filtered.filter((i) => i.sourceType === filters.sourceType)
      filtered.sort(
        (a, b) =>
          b.sourceDate.getTime() - a.sourceDate.getTime() ||
          (b.id as string).localeCompare(a.id as string),
      )
      if (cursor) {
        const idx = filtered.findIndex(
          (i) =>
            i.sourceDate.getTime() === cursor.sourceDate.getTime() && i.id === cursor.id,
        )
        filtered = idx >= 0 ? filtered.slice(idx + 1) : []
      }
      const sliced = filtered.slice(0, limit)
      const last = sliced[sliced.length - 1]
      return {
        items: sliced,
        nextCursor: last ? { sourceDate: last.sourceDate, id: last.id } : null,
      }
    },
    create: async (item) => {
      items.push(item)
      return item
    },
    updateStatus: async (id, orgId, status, timestampFields) => {
      const item = items.find((i) => i.id === id && i.organizationId === orgId)
      if (!item) throw new Error('not found')
      const idx = items.indexOf(item)
      items[idx] = { ...item, status, updatedAt: new Date(), ...timestampFields }
      return items[idx]
    },
    bulkUpdateStatus: async (ids, orgId, status, timestampFields) => {
      let updated = 0
      for (const id of ids) {
        const item = items.find((i) => i.id === id && i.organizationId === orgId)
        if (item) {
          const idx = items.indexOf(item)
          items[idx] = { ...item, status, updatedAt: new Date(), ...timestampFields }
          updated++
        }
      }
      return { updated }
    },
    updateAssignment: async (id, orgId, assignedTo) => {
      const item = items.find((i) => i.id === id && i.organizationId === orgId)
      if (!item) throw new Error('not found')
      const idx = items.indexOf(item)
      items[idx] = { ...item, assignedTo, updatedAt: new Date() }
      return items[idx]
    },
    countByStatus: async (orgId, status) =>
      items.filter((i) => i.organizationId === orgId && i.status === status).length,
    syncDenormalizedFields: async () => {},
    findDetailById: async (id, orgId) => {
      const item = items.find((i) => i.id === id && i.organizationId === orgId)
      if (!item) return null
      if (item.sourceType === 'review') {
        return {
          item,
          reviewerName: 'Test Reviewer',
          reviewText: 'Test review text',
          reviewerProfilePhotoUrl: null,
          feedbackComment: null,
          feedbackRatingValue: null,
        }
      }
      return {
        item,
        reviewerName: null,
        reviewText: null,
        reviewerProfilePhotoUrl: null,
        feedbackComment: 'Test feedback comment',
        feedbackRatingValue: item.rating,
      }
    },
  }
  return { ...repo, items }
}
