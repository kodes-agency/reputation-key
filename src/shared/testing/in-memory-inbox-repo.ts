// Shared testing utility — in-memory inbox repository for unit tests
import type { InboxRepository } from '#/contexts/inbox/application/ports/inbox.repository'
import type { InboxItem } from '#/contexts/inbox/domain/types'
import { unbrandAll } from '#/shared/domain/ids'

export function createInMemoryInboxRepo(): InboxRepository & { items: InboxItem[] } {
  const items: InboxItem[] = []
  const repo: InboxRepository = {
    findById: async (id, orgId) =>
      items.find((i) => i.id === id && i.organizationId === orgId) ?? null,
    findByIds: async (ids, orgId) =>
      items.filter(
        (i) => unbrandAll(ids).includes(i.id as string) && i.organizationId === orgId,
      ),
    findBySource: async (sourceType, sourceId, orgId) =>
      items.find(
        (i) =>
          i.sourceType === sourceType &&
          i.sourceId === sourceId &&
          i.organizationId === orgId,
      ) ?? null,
    findFilteredPaginated: async (filters, orgId, cursor, limit = 50) => {
      let filtered = items.filter((i) => i.organizationId === orgId)
      if (filters.status)
        filtered = filtered.filter((i) =>
          Array.isArray(filters.status)
            ? filters.status.includes(i.status)
            : i.status === filters.status,
        )
      if (filters.propertyId)
        filtered = filtered.filter((i) => i.propertyId === filters.propertyId)
      if (filters.propertyIds && filters.propertyIds.length > 0)
        filtered = filtered.filter((i) => filters.propertyIds!.includes(i.propertyId))
      if (filters.sourceType)
        filtered = filtered.filter((i) => i.sourceType === filters.sourceType)
      if (filters.isEscalated !== undefined)
        filtered = filtered.filter((i) =>
          filters.isEscalated
            ? i.isEscalated && i.escalationResolvedAt === null
            : !i.isEscalated,
        )
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
      // Fetch limit+1 to detect if there are more pages (matches Drizzle repo behavior)
      const overflow = filtered.slice(0, limit + 1)
      const hasMore = overflow.length > limit
      const sliced = overflow.slice(0, limit)
      const last = sliced[sliced.length - 1]
      return {
        items: sliced,
        nextCursor: hasMore && last ? { sourceDate: last.sourceDate, id: last.id } : null,
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
      items[idx] = {
        ...item,
        status,
        updatedAt: new Date(),
        ...timestampFields,
      }
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
    countByStatus: async (orgId, status, propertyIds) =>
      items.filter(
        (i) =>
          i.organizationId === orgId &&
          i.status === status &&
          (!propertyIds ||
            propertyIds.length === 0 ||
            propertyIds.includes(i.propertyId)),
      ).length,
    setEscalation: async (id, orgId, escalatedBy, now) => {
      const item = items.find((i) => i.id === id && i.organizationId === orgId)
      if (!item) throw new Error('not found')
      const idx = items.indexOf(item)
      const stamp = now ?? new Date()
      items[idx] = {
        ...item,
        isEscalated: true,
        escalatedAt: stamp,
        escalatedBy,
        escalationResolvedAt: null,
        escalationResolvedBy: null,
        updatedAt: stamp,
      }
      return items[idx]
    },
    resolveEscalation: async (id, orgId, resolvedBy, now) => {
      const item = items.find((i) => i.id === id && i.organizationId === orgId)
      if (!item) throw new Error('not found')
      const idx = items.indexOf(item)
      const stamp = now ?? new Date()
      items[idx] = {
        ...item,
        isEscalated: false,
        escalationResolvedAt: stamp,
        escalationResolvedBy: resolvedBy,
        updatedAt: stamp,
      }
      return items[idx]
    },
    countEscalatedActive: async (orgId, propertyIds) =>
      items.filter(
        (i) =>
          i.organizationId === orgId &&
          i.isEscalated &&
          i.escalationResolvedAt === null &&
          (!propertyIds ||
            propertyIds.length === 0 ||
            propertyIds.includes(i.propertyId)),
      ).length,
    countOpenSince: async (orgId, since, propertyIds) =>
      items.filter(
        (i) =>
          i.organizationId === orgId &&
          i.status === 'open' &&
          (!since || i.createdAt.getTime() >= since.getTime()) &&
          (!propertyIds ||
            propertyIds.length === 0 ||
            propertyIds.includes(i.propertyId)),
      ).length,
    findDetailById: async (id, orgId) => {
      const item = items.find((i) => i.id === id && i.organizationId === orgId)
      if (!item) return null
      if (item.sourceType === 'review') {
        return {
          item,
          reviewText: 'Test review text',
          reviewerProfilePhotoUrl: null,
          reviewContentStatus: 'available' as const,
          feedbackComment: null,
          feedbackRatingValue: null,
        }
      }
      return {
        item,
        reviewText: null,
        reviewerProfilePhotoUrl: null,
        reviewContentStatus: null,
        feedbackComment: 'Test feedback comment',
        feedbackRatingValue: item.rating,
      }
    },
  }
  return { ...repo, items }
}
