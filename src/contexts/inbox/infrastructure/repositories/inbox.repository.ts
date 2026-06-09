// Inbox context — Drizzle inbox repository implementation
// Per architecture: factory function returning Readonly<{ method }>).
// Wrapped in trace() for observability.
//
// Cross-context data (review/feedback/property) is fetched via lookup ports
// defined in application/ports/ — never via direct table JOINs.

import { and, eq, desc, inArray, sql, gte, lte } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { inboxItems } from '#/shared/db/schema/inbox.schema'
import type {
  InboxRepository,
  InboxFilters,
  Cursor,
  PaginatedResult,
} from '../../application/ports/inbox.repository'
import type { ReviewLookupPort } from '../../application/ports/review-lookup.port'
import type { FeedbackLookupPort } from '../../application/ports/feedback-lookup.port'
import type { PropertyLookupPort } from '../../application/ports/property-lookup.port'
import type { InboxItem, InboxStatus, SourceType } from '../../domain/types'
import type { InboxItemId, OrganizationId, UserId } from '#/shared/domain/ids'
import { reviewId, feedbackId, propertyId } from '#/shared/domain/ids'
import { inboxItemFromRow, inboxItemToInsertRow } from '../mappers/inbox.mapper'
import { trace } from '#/shared/observability/trace'
import { getLogger } from '#/shared/observability/logger'

const log = getLogger().child({ component: 'inbox-repo' })

type InboxItemRow = Parameters<typeof inboxItemFromRow>[0]

type LookupPorts = Readonly<{
  reviewLookup: ReviewLookupPort
  feedbackLookup: FeedbackLookupPort
  propertyLookup: PropertyLookupPort
}>

const withDefaults = (row: InboxItemRow): InboxItem => ({
  ...inboxItemFromRow(row),
  reviewerName: null,
  propertyName: null,
})

export const createInboxRepository = (
  db: Database,
  ports: LookupPorts,
): InboxRepository => ({
  findById: async (id: InboxItemId, orgId: OrganizationId) => {
    return trace('inbox.findById', async () => {
      const start = Date.now()
      log.debug({ id: id as string, orgId: orgId as string }, 'querying inbox findById')
      const rows = await db
        .select()
        .from(inboxItems)
        .where(and(eq(inboxItems.id, id), eq(inboxItems.organizationId, orgId)))
        .limit(1)
      log.debug(
        { id: id as string, orgId: orgId as string, duration: Date.now() - start },
        'inbox findById complete',
      )
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
      const start = Date.now()
      log.debug({ orgId: orgId as string, limit }, 'querying inbox findFilteredPaginated')
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
        const status = filters.status
        if (typeof status === 'string') {
          conditions.push(eq(inboxItems.status, status))
        } else {
          conditions.push(inArray(inboxItems.status, [...status] as InboxStatus[]))
        }
      }
      if (filters.sourceType) {
        conditions.push(eq(inboxItems.sourceType, filters.sourceType))
      }
      if (filters.platform) {
        conditions.push(eq(inboxItems.platform, filters.platform))
      }
      if (filters.ratingMin !== undefined) {
        conditions.push(gte(inboxItems.rating, filters.ratingMin))
      }
      if (filters.ratingMax !== undefined) {
        conditions.push(lte(inboxItems.rating, filters.ratingMax))
      }
      if (filters.sourceDateFrom) {
        conditions.push(gte(inboxItems.sourceDate, filters.sourceDateFrom))
      }
      if (filters.sourceDateTo) {
        conditions.push(lte(inboxItems.sourceDate, filters.sourceDateTo))
      }
      if (filters.q) {
        const escaped = filters.q.replace(/%/g, '\\%').replace(/_/g, '\\_')
        conditions.push(sql`${inboxItems.snippet} ilike ${'%' + escaped + '%'}`)
      }

      // Cursor-based pagination: sourceDate DESC, id DESC
      // Keyset pagination: ORDER BY sourceDate DESC, id DESC means
      // "next page" = rows with (sourceDate, id) < cursor value
      if (cursor) {
        conditions.push(
          sql`(${inboxItems.sourceDate}, ${inboxItems.id}) < (${cursor.sourceDate}, ${cursor.id})`,
        )
      }

      // Fetch inbox_items only — no cross-context JOINs
      const rows = await db
        .select()
        .from(inboxItems)
        .where(and(...conditions))
        .orderBy(desc(inboxItems.sourceDate), desc(inboxItems.id))
        .limit(limit + 1)

      const sliced = rows.slice(0, limit)

      // Enrich with review/property names via lookup ports (batch)
      const reviewIdsToFetch = sliced
        .filter((r) => r.sourceType === 'review')
        .map((r) => r.sourceId)

      const propertyIdsToFetch = [...new Set(sliced.map((r) => r.propertyId))]

      const [reviewSnippets, propertyNames] = await Promise.all([
        batchReviewNames(ports, reviewIdsToFetch, orgId),
        batchPropertyNames(ports, propertyIdsToFetch, orgId),
      ])

      const items = sliced.map((row) => ({
        ...inboxItemFromRow(row),
        reviewerName:
          row.sourceType === 'review'
            ? (reviewSnippets.get(row.sourceId)?.reviewerName ?? null)
            : null,
        propertyName: propertyNames.get(row.propertyId) ?? null,
      }))

      const hasNext = rows.length > limit
      const lastItem = items[items.length - 1]

      const nextCursor: Cursor | null =
        hasNext && lastItem ? { sourceDate: lastItem.sourceDate, id: lastItem.id } : null

      log.debug(
        {
          orgId: orgId as string,
          itemCount: items.length,
          hasNext,
          duration: Date.now() - start,
        },
        'inbox findFilteredPaginated complete',
      )

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
      const result = await db
        .update(inboxItems)
        .set({ ...fields, updatedAt: now ?? new Date() })
        .where(and(eq(inboxItems.id, id), eq(inboxItems.organizationId, orgId)))
        .returning()

      if (!result[0]) {
        log.warn(
          { id: id as string, orgId: orgId as string },
          'syncDenormalizedFields matched no rows — fire-and-forget',
        )
      }
    })
  },

  findDetailById: async (id: InboxItemId, orgId: OrganizationId) => {
    return trace('inbox.findDetailById', async () => {
      const start = Date.now()
      log.debug(
        { id: id as string, orgId: orgId as string },
        'querying inbox findDetailById',
      )
      const rows = await db
        .select()
        .from(inboxItems)
        .where(and(eq(inboxItems.id, id), eq(inboxItems.organizationId, orgId)))
        .limit(1)

      if (!rows[0]) return null

      const item = withDefaults(rows[0])

      // Enrich with property name via lookup port
      const propertyName = await ports.propertyLookup.getPropertyNameById(
        propertyId(item.propertyId),
        orgId,
      )

      // Enrich via lookup ports instead of cross-context JOINs
      let reviewerName: string | null = null
      if (item.sourceType === 'review') {
        const snippet = await ports.reviewLookup.getReviewSnippetById(
          reviewId(item.sourceId),
          orgId,
        )
        reviewerName = snippet?.reviewerName ?? null
        log.debug(
          {
            id: id as string,
            orgId: orgId as string,
            duration: Date.now() - start,
          },
          'inbox findDetailById review enrichment',
        )
        return {
          item: { ...item, propertyName, reviewerName },
          reviewText: snippet?.text ?? null,
          reviewerProfilePhotoUrl: snippet?.reviewerProfilePhotoUrl ?? null,
          feedbackComment: null,
          feedbackRatingValue: null,
        }
      }

      // sourceType === 'feedback'
      const snippet = await ports.feedbackLookup.getFeedbackSnippetById(
        feedbackId(item.sourceId),
        orgId,
      )
      log.debug(
        { id: id as string, orgId: orgId as string, duration: Date.now() - start },
        'inbox findDetailById complete',
      )
      return {
        item: { ...item, propertyName, reviewerName },
        reviewText: null,
        reviewerProfilePhotoUrl: null,
        feedbackComment: snippet?.comment ?? null,
        feedbackRatingValue: snippet?.ratingValue ?? null,
      }
    })
  },
})

// ── Batch helpers ──────────────────────────────────────────────────

async function batchReviewNames(
  ports: LookupPorts,
  sourceIds: string[],
  orgId: OrganizationId,
): Promise<Map<string, { reviewerName: string | null }>> {
  const map = new Map<string, { reviewerName: string | null }>()
  if (sourceIds.length === 0) return map
  const snippets = await ports.reviewLookup.getReviewSnippetsByIds(
    sourceIds.map(reviewId),
    orgId,
  )
  for (const [id, snippet] of snippets) {
    map.set(id, { reviewerName: snippet.reviewerName })
  }
  return map
}

async function batchPropertyNames(
  ports: LookupPorts,
  propertyIds: string[],
  orgId: OrganizationId,
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  if (propertyIds.length === 0) return map
  const names = await ports.propertyLookup.getPropertyNamesByIds(
    propertyIds.map(propertyId),
    orgId,
  )
  for (const [id, name] of names) {
    map.set(id, name)
  }
  return map
}
