// Inbox context — Drizzle inbox repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Wrapped in trace() for observability.

import { and, eq, desc, inArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { inboxItems } from '#/shared/db/schema/inbox.schema'
import { reviews } from '#/shared/db/schema/review.schema'
import { feedback, ratings } from '#/shared/db/schema/guest.schema'
import { properties } from '#/shared/db/schema/property.schema'
import type {
  InboxRepository,
  InboxFilters,
  Cursor,
  PaginatedResult,
} from '../../application/ports/inbox.repository'
import type { InboxItem, InboxStatus, SourceType } from '../../domain/types'
import type { InboxItemId, OrganizationId, UserId } from '#/shared/domain/ids'
import { inboxItemFromRow, inboxItemToInsertRow } from '../mappers/inbox.mapper'
import { trace } from '#/shared/observability/trace'

type InboxItemRow = Parameters<typeof inboxItemFromRow>[0]

const withDefaults = (row: InboxItemRow): InboxItem => ({
  ...inboxItemFromRow(row),
  reviewerName: null,
  propertyName: null,
})

export const createInboxRepository = (db: Database): InboxRepository => ({
  findById: async (id: InboxItemId, orgId: OrganizationId) => {
    return trace('inbox.findById', async () => {
      const rows = await db
        .select()
        .from(inboxItems)
        .where(and(eq(inboxItems.id, id), eq(inboxItems.organizationId, orgId)))
        .limit(1)
      return rows[0] ? withDefaults(rows[0]) : null
    })
  },

  findByIds: async (ids: ReadonlyArray<InboxItemId>, orgId: OrganizationId) => {
    return trace('inbox.findByIds', async () => {
      if (ids.length === 0) return []
      const rows = await db
        .select()
        .from(inboxItems)
        .where(
          and(
            eq(inboxItems.organizationId, orgId),
            inArray(inboxItems.id, [...ids] as string[]),
          ),
        )
      return rows.map(withDefaults)
    })
  },

  findBySource: async (
    sourceType: SourceType,
    sourceId: string,
    orgId: OrganizationId,
  ) => {
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
      return rows[0] ? withDefaults(rows[0]) : null
    })
  },

  findFilteredPaginated: async (
    filters: InboxFilters,
    orgId: OrganizationId,
    cursor?: Cursor,
    limit: number = 50,
  ) => {
    return trace('inbox.findFilteredPaginated', async () => {
      const conditions = [eq(inboxItems.organizationId, orgId)]

      if (filters.propertyId) {
        conditions.push(eq(inboxItems.propertyId, filters.propertyId))
      } else if (filters.propertyIds) {
        if (filters.propertyIds.length === 0) {
          return { items: [], nextCursor: null } as PaginatedResult
        }
        conditions.push(
          inArray(inboxItems.propertyId, [...filters.propertyIds] as string[]),
        )
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
        .select({
          inboxItems,
          reviewerName: reviews.reviewerName,
          propertyName: properties.name,
        })
        .from(inboxItems)
        .leftJoin(
          reviews,
          and(eq(inboxItems.sourceType, 'review'), eq(inboxItems.sourceId, reviews.id)),
        )
        .leftJoin(properties, sql`${inboxItems.propertyId}::uuid = ${properties.id}`)
        .where(and(...conditions))
        .orderBy(desc(inboxItems.sourceDate), desc(inboxItems.id))
        .limit(limit + 1)

      const items = rows.slice(0, limit).map((row) => ({
        ...inboxItemFromRow(row.inboxItems),
        reviewerName: row.reviewerName ?? null,
        propertyName: row.propertyName ?? null,
      }))
      const hasNext = rows.length > limit
      const lastItem = items[items.length - 1]

      const nextCursor: Cursor | null =
        hasNext && lastItem ? { sourceDate: lastItem.sourceDate, id: lastItem.id } : null

      return { items, nextCursor } as PaginatedResult
    })
  },

  create: async (item: InboxItem) => {
    return trace('inbox.create', async () => {
      const row = inboxItemToInsertRow(item)
      const result = await db.insert(inboxItems).values(row).returning()

      if (!result[0]) {
        throw new Error('Inbox item insert failed — no row returned')
      }
      return withDefaults(result[0])
    })
  },

  updateStatus: async (
    id: InboxItemId,
    orgId: OrganizationId,
    status: InboxStatus,
    timestampFields: Partial<Record<string, Date>>,
    now?: Date,
  ) => {
    return trace('inbox.updateStatus', async () => {
      const result = await db
        .update(inboxItems)
        .set({
          status,
          updatedAt: now ?? new Date(),
          ...timestampFields,
        })
        .where(and(eq(inboxItems.id, id), eq(inboxItems.organizationId, orgId)))
        .returning()

      if (!result[0]) {
        throw new Error('Inbox item status update failed — no row returned')
      }
      return withDefaults(result[0])
    })
  },

  bulkUpdateStatus: async (
    ids: ReadonlyArray<InboxItemId>,
    orgId: OrganizationId,
    status: InboxStatus,
    timestampFields: Partial<Record<string, Date>>,
    now?: Date,
  ) => {
    return trace('inbox.bulkUpdateStatus', async () => {
      const result = await db
        .update(inboxItems)
        .set({
          status,
          updatedAt: now ?? new Date(),
          ...timestampFields,
        })
        .where(
          and(
            eq(inboxItems.organizationId, orgId),
            inArray(inboxItems.id, [...ids] as string[]),
          ),
        )
        .returning()

      return { updated: result.length }
    })
  },

  updateAssignment: async (
    id: InboxItemId,
    orgId: OrganizationId,
    assignedTo: UserId | null,
    now?: Date,
  ) => {
    return trace('inbox.updateAssignment', async () => {
      const result = await db
        .update(inboxItems)
        .set({
          assignedTo,
          updatedAt: now ?? new Date(),
        })
        .where(and(eq(inboxItems.id, id), eq(inboxItems.organizationId, orgId)))
        .returning()

      if (!result[0]) {
        throw new Error('Inbox item assignment update failed — no row returned')
      }
      return withDefaults(result[0])
    })
  },

  countByStatus: async (orgId: OrganizationId, status: InboxStatus) => {
    return trace('inbox.countByStatus', async () => {
      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(inboxItems)
        .where(and(eq(inboxItems.organizationId, orgId), eq(inboxItems.status, status)))
      return Number(result[0]?.count ?? 0)
    })
  },

  syncDenormalizedFields: async (
    id: InboxItemId,
    orgId: OrganizationId,
    fields: { rating?: number; snippet?: string; sourceDate?: Date },
    now?: Date,
  ) => {
    return trace('inbox.syncDenormalizedFields', async () => {
      await db
        .update(inboxItems)
        .set({ ...fields, updatedAt: now ?? new Date() })
        .where(and(eq(inboxItems.id, id), eq(inboxItems.organizationId, orgId)))
    })
  },

  findDetailById: async (id: InboxItemId, orgId: OrganizationId) => {
    return trace('inbox.findDetailById', async () => {
      const rows = await db
        .select()
        .from(inboxItems)
        .where(and(eq(inboxItems.id, id), eq(inboxItems.organizationId, orgId)))
        .limit(1)

      if (!rows[0]) return null

      const item = withDefaults(rows[0])

      // JOIN with source table based on sourceType
      if (item.sourceType === 'review') {
        const reviewRows = await db
          .select({
            reviewerName: reviews.reviewerName,
            reviewText: reviews.text,
            reviewerProfilePhotoUrl: reviews.reviewerProfilePhotoUrl,
          })
          .from(reviews)
          .where(and(eq(reviews.id, item.sourceId), eq(reviews.organizationId, orgId)))
          .limit(1)

        const review = reviewRows[0]
        return {
          item,
          reviewerName: review?.reviewerName ?? null,
          reviewText: review?.reviewText ?? null,
          reviewerProfilePhotoUrl: review?.reviewerProfilePhotoUrl ?? null,
          feedbackComment: null,
          feedbackRatingValue: null,
        }
      }

      // sourceType === 'feedback'
      const feedbackRows = await db
        .select({
          comment: feedback.comment,
          ratingId: feedback.ratingId,
        })
        .from(feedback)
        .where(and(eq(feedback.id, item.sourceId), eq(feedback.organizationId, orgId)))
        .limit(1)

      const fb = feedbackRows[0]
      let ratingValue: number | null = null
      if (fb?.ratingId) {
        const ratingRows = await db
          .select({ value: ratings.value })
          .from(ratings)
          .where(and(eq(ratings.id, fb.ratingId), eq(ratings.organizationId, orgId)))
          .limit(1)
        ratingValue = ratingRows[0]?.value ?? null
      }

      return {
        item,
        reviewerName: null,
        reviewText: null,
        reviewerProfilePhotoUrl: null,
        feedbackComment: fb?.comment ?? null,
        feedbackRatingValue: ratingValue,
      }
    })
  },
})
