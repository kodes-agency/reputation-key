// Inbox context — Drizzle inbox repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Wrapped in trace() for observability.

import { and, eq, desc, inArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { inboxItems } from '#/shared/db/schema/inbox.schema'
import type { InboxRepository, InboxFilters, Cursor, PaginatedResult } from '../../application/ports/inbox.repository'
import type { InboxItem, InboxItemDetail, InboxStatus, SourceType } from '../../domain/types'
import type { InboxItemId, OrganizationId, UserId } from '#/shared/domain/ids'
import { inboxItemFromRow, inboxItemToInsertRow } from '../mappers/inbox.mapper'
import { trace } from '#/shared/observability/trace'

export const createInboxRepository = (db: Database): InboxRepository => ({
  findById: async (id: InboxItemId, orgId: OrganizationId) => {
    return trace('inbox.findById', async () => {
      const rows = await db
        .select()
        .from(inboxItems)
        .where(
          and(
            eq(inboxItems.id, id),
            eq(inboxItems.organizationId, orgId),
          ),
        )
        .limit(1)
      return rows[0] ? inboxItemFromRow(rows[0]) : null
    })
  },

  findBySource: async (sourceType: SourceType, sourceId: string, orgId: OrganizationId) => {
    return trace('inbox.findBySource', async () => {
      const rows = await db
        .select()
        .from(inboxItems)
        .where(
          and(
            eq(inboxItems.sourceType, sourceType),
            eq(inboxItems.sourceId, sourceId),
            eq(inboxItems.organizationId, orgId),
          ),
        )
        .limit(1)
      return rows[0] ? inboxItemFromRow(rows[0]) : null
    })
  },

  findFilteredPaginated: async (filters: InboxFilters, orgId: OrganizationId, cursor?: Cursor, limit: number = 50) => {
    return trace('inbox.findFilteredPaginated', async () => {
      const conditions = [eq(inboxItems.organizationId, orgId)]

      if (filters.propertyId) {
        conditions.push(eq(inboxItems.propertyId, filters.propertyId))
      }
      if (filters.status) {
        conditions.push(eq(inboxItems.status, filters.status))
      }
      if (filters.sourceType) {
        conditions.push(eq(inboxItems.sourceType, filters.sourceType))
      }
      if (filters.platform) {
        conditions.push(eq(inboxItems.platform, filters.platform))
      }
      if (filters.ratingMin !== undefined) {
        conditions.push(sql`${inboxItems.rating} >= ${filters.ratingMin}`)
      }
      if (filters.ratingMax !== undefined) {
        conditions.push(sql`${inboxItems.rating} <= ${filters.ratingMax}`)
      }
      if (filters.sourceDateFrom) {
        conditions.push(sql`${inboxItems.sourceDate} >= ${filters.sourceDateFrom}`)
      }
      if (filters.sourceDateTo) {
        conditions.push(sql`${inboxItems.sourceDate} <= ${filters.sourceDateTo}`)
      }

      // Cursor-based pagination: sourceDate DESC, id DESC
      if (cursor) {
        conditions.push(
          sql`(${inboxItems.sourceDate}, ${inboxItems.id}) < (${cursor.sourceDate}, ${cursor.id})`,
        )
      }

      const rows = await db
        .select()
        .from(inboxItems)
        .where(and(...conditions))
        .orderBy(desc(inboxItems.sourceDate), desc(inboxItems.id))
        .limit(limit + 1)

      const items = rows.slice(0, limit).map(inboxItemFromRow)
      const hasNext = rows.length > limit
      const lastItem = items[items.length - 1]

      const nextCursor: Cursor | null =
        hasNext && lastItem
          ? { sourceDate: lastItem.sourceDate, id: lastItem.id }
          : null

      return { items, nextCursor } as PaginatedResult
    })
  },

  create: async (item: InboxItem) => {
    return trace('inbox.create', async () => {
      const row = inboxItemToInsertRow(item)
      const result = await db
        .insert(inboxItems)
        .values(row)
        .returning()

      if (!result[0]) {
        throw new Error('Inbox item insert failed — no row returned')
      }
      return inboxItemFromRow(result[0])
    })
  },

  updateStatus: async (id: InboxItemId, orgId: OrganizationId, status: InboxStatus, timestampFields: Partial<Record<string, Date>>) => {
    return trace('inbox.updateStatus', async () => {
      const result = await db
        .update(inboxItems)
        .set({
          status,
          updatedAt: new Date(),
          ...timestampFields,
        })
        .where(
          and(
            eq(inboxItems.id, id),
            eq(inboxItems.organizationId, orgId),
          ),
        )
        .returning()

      if (!result[0]) {
        throw new Error('Inbox item status update failed — no row returned')
      }
      return inboxItemFromRow(result[0])
    })
  },

  bulkUpdateStatus: async (ids: ReadonlyArray<InboxItemId>, orgId: OrganizationId, status: InboxStatus, timestampFields: Partial<Record<string, Date>>) => {
    return trace('inbox.bulkUpdateStatus', async () => {
      const result = await db
        .update(inboxItems)
        .set({
          status,
          updatedAt: new Date(),
          ...timestampFields,
        })
        .where(
          and(
            eq(inboxItems.organizationId, orgId),
            inArray(inboxItems.id, ids as unknown as string[]),
          ),
        )
        .returning()

      return { updated: result.length }
    })
  },

  updateAssignment: async (id: InboxItemId, orgId: OrganizationId, assignedTo: UserId | null) => {
    return trace('inbox.updateAssignment', async () => {
      const result = await db
        .update(inboxItems)
        .set({
          assignedTo,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(inboxItems.id, id),
            eq(inboxItems.organizationId, orgId),
          ),
        )
        .returning()

      if (!result[0]) {
        throw new Error('Inbox item assignment update failed — no row returned')
      }
      return inboxItemFromRow(result[0])
    })
  },

  countByStatus: async (orgId: OrganizationId, status: InboxStatus) => {
    return trace('inbox.countByStatus', async () => {
      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(inboxItems)
        .where(
          and(
            eq(inboxItems.organizationId, orgId),
            eq(inboxItems.status, status),
          ),
        )
      return Number(result[0]?.count ?? 0)
    })
  },

  syncDenormalizedFields: async (id: InboxItemId, orgId: OrganizationId, fields: { rating?: number; snippet?: string; sourceDate?: Date }) => {
    return trace('inbox.syncDenormalizedFields', async () => {
      await db
        .update(inboxItems)
        .set({ ...fields, updatedAt: new Date() })
        .where(
          and(
            eq(inboxItems.id, id),
            eq(inboxItems.organizationId, orgId),
          ),
        )
    })
  },

  findDetailById: async (id: InboxItemId, orgId: OrganizationId) => {
    return trace('inbox.findDetailById', async () => {
      // Fetch the inbox item; LEFT JOINs to reviews/feedback deferred to integration testing
      const rows = await db
        .select()
        .from(inboxItems)
        .where(
          and(
            eq(inboxItems.id, id),
            eq(inboxItems.organizationId, orgId),
          ),
        )
        .limit(1)

      if (!rows[0]) return null

      const item = inboxItemFromRow(rows[0])

      // Joins deferred — return item with null source detail fields
      const detail: InboxItemDetail = {
        item,
        reviewerName: null,
        reviewText: null,
        reviewerProfilePhotoUrl: null,
        feedbackComment: null,
        feedbackRatingValue: null,
      }
      return detail
    })
  },
})
