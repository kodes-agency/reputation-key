// Shared testing utility — in-memory inbox repository for unit tests
import type { InboxRepository } from '#/contexts/inbox/application/ports/inbox.repository'
import type { ReviewCategory } from '#/contexts/inbox/application/ports/ai-review-insights.port'
import type { InboxItem } from '#/contexts/inbox/domain/types'
import { unbrandAll } from '#/shared/domain/ids'

export function createInMemoryInboxRepo(): InboxRepository & {
  items: InboxItem[]
  categories: Map<string, ReviewCategory>
} {
  const items: InboxItem[] = []
  const categories = new Map<string, ReviewCategory>()
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
      if (filters.platform)
        filtered = filtered.filter((i) => i.platform === filters.platform)
      if (filters.ratingMin !== undefined)
        filtered = filtered.filter(
          (i) => i.rating !== null && i.rating >= filters.ratingMin!,
        )
      if (filters.ratingMax !== undefined)
        filtered = filtered.filter(
          (i) => i.rating !== null && i.rating <= filters.ratingMax!,
        )
      if (filters.q) {
        const query = filters.q.toLocaleLowerCase()
        filtered = filtered.filter((i) =>
          (i.snippet ?? '').toLocaleLowerCase().includes(query),
        )
      }
      if (filters.attention?.length)
        filtered = filtered.filter(
          (i) => i.attention !== null && filters.attention!.includes(i.attention!),
        )
      if (filters.category?.length)
        filtered = filtered.filter((item) => {
          const category = categories.get(item.id)
          return category !== undefined && filters.category!.includes(category)
        })
      if (filters.isEscalated !== undefined)
        filtered = filtered.filter((i) =>
          filters.isEscalated
            ? i.isEscalated && i.escalationResolvedAt === null
            : !i.isEscalated,
        )
      const direction = filters.sort === 'oldest' ? 1 : -1
      filtered.sort(
        (a, b) =>
          direction * (a.sourceDate.getTime() - b.sourceDate.getTime()) ||
          direction * (a.id as string).localeCompare(b.id as string),
      )
      const totalCount = filtered.length
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
        totalCount,
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
    updateSourceMeta: async (id, orgId, fields, now) => {
      const item = items.find((i) => i.id === id && i.organizationId === orgId)
      if (!item) return null
      const idx = items.indexOf(item)
      items[idx] = {
        ...item,
        sourceDate: fields.sourceDate,
        platform: fields.platform,
        updatedAt: now ?? new Date(),
      }
      return items[idx]
    },
    scanReviewItems: async (orgId, opts) => {
      let filtered = items.filter(
        (i) =>
          i.organizationId === orgId &&
          i.sourceType === 'review' &&
          (!opts.propertyId || i.propertyId === opts.propertyId),
      )
      filtered.sort((a, b) => (a.id as string).localeCompare(b.id as string))
      if (opts.cursor) {
        filtered = filtered.filter((i) => (i.id as string) > (opts.cursor as string))
      }
      return filtered.slice(0, opts.limit)
    },
    findDetailById: async (id, orgId) => {
      const item = items.find((i) => i.id === id && i.organizationId === orgId)
      if (!item) return null
      if (item.sourceType === 'review') {
        return {
          item,
          reviewText: 'Test review text',
          reviewTranslatedText: null,
          reviewerProfilePhotoUrl: null,
          reviewContentStatus: 'available' as const,
          feedbackComment: null,
          feedbackRatingValue: null,
        }
      }
      return {
        item,
        reviewText: null,
        reviewTranslatedText: null,
        reviewerProfilePhotoUrl: null,
        reviewContentStatus: null,
        feedbackComment: 'Test feedback comment',
        feedbackRatingValue: item.rating,
      }
    },
  }
  return { ...repo, items, categories }
}
