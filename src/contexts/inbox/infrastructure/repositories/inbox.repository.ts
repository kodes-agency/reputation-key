// Inbox context — Drizzle inbox repository implementation
// Per architecture: factory function returning Readonly<{ method }>).
// Wrapped in trace() for observability.
//
// Cross-context data (review/feedback/property) is fetched via lookup ports
// defined in application/ports/ — never via direct table JOINs.

import { and, eq, desc, inArray, sql, gte, gt, lte, isNull } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { inboxItems } from '#/shared/db/schema/inbox.schema'
import type {
  InboxRepository,
  InboxFilters,
  Cursor,
  PaginatedResult,
} from '../../application/ports/inbox.repository'
import type {
  ReviewLookupPort,
  ReviewSnippet,
} from '../../application/ports/review-lookup.port'
import type { FeedbackLookupPort } from '../../application/ports/feedback-lookup.port'
import type { PropertyLookupPort } from '../../application/ports/property-lookup.port'
import type { InboxItem, InboxStatus, SourceType } from '../../domain/types'
import type { InboxItemId, OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import { reviewId, feedbackId, propertyId } from '#/shared/domain/ids'
import { inboxItemFromRow, inboxItemToInsertRow } from '../mappers/inbox.mapper'
import { trace } from '#/shared/observability/trace'
import { getLogger } from '#/shared/observability/logger'
import { inboxError } from '../../domain/errors'

const log = getLogger().child({ component: 'inbox-repo' })

type InboxItemRow = Parameters<typeof inboxItemFromRow>[0]

type LookupPorts = Readonly<{
  reviewLookup: ReviewLookupPort
  feedbackLookup: FeedbackLookupPort
  propertyLookup: PropertyLookupPort
}>

const withDefaults = (row: InboxItemRow): InboxItem => ({
  ...inboxItemFromRow(row),
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
      const conditions = buildFilterConditions(filters, orgId)
      if (conditions === null) return { items: [], nextCursor: null } as PaginatedResult

      // BQC-1.2: rating range / free-text search run against live, eligible
      // reviews via the Review-owned query (no denormalized copies, no JOINs).
      if (
        filters.ratingMin !== undefined ||
        filters.ratingMax !== undefined ||
        filters.q
      ) {
        const eligibleIds = await ports.reviewLookup.findEligibleReviewIds(orgId, {
          ratingMin: filters.ratingMin,
          ratingMax: filters.ratingMax,
          textQuery: filters.q,
        })
        if (eligibleIds.length === 0)
          return { items: [], nextCursor: null } as PaginatedResult
        conditions.push(inArray(inboxItems.sourceId, [...eligibleIds]))
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

      // Enrich with live eligible review content + property names (batch)
      const reviewIdsToFetch = sliced
        .filter((r) => r.sourceType === 'review')
        .map((r) => r.sourceId)

      const propertyIdsToFetch = [...new Set(sliced.map((r) => r.propertyId))]

      const [reviewSnippets, propertyNames] = await Promise.all([
        batchReviewSnippets(ports, reviewIdsToFetch, orgId),
        batchPropertyNames(ports, propertyIdsToFetch, orgId),
      ])

      const items = sliced.map((row) => {
        const item = inboxItemFromRow(row)
        // BQC-1.2: rating/snippet/reviewerName come only from the live
        // eligible lookup — expired/missing content renders as nulls.
        const live =
          row.sourceType === 'review' ? reviewSnippets.get(row.sourceId) : undefined
        return {
          ...item,
          rating: live?.rating ?? null,
          snippet: live?.text ?? null,
          reviewerName: live?.reviewerName ?? null,
          propertyName: propertyNames.get(row.propertyId) ?? null,
        }
      })

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

  create: async (item: InboxItem, orgId: OrganizationId) => {
    return trace('inbox.create', async () => {
      if (item.organizationId !== orgId) {
        throw inboxError('forbidden', 'InboxItem.create: tenant mismatch')
      }
      const row = inboxItemToInsertRow(item)
      const result = await db.insert(inboxItems).values(row).returning()

      if (!result[0]) {
        throw inboxError('not_found', 'Inbox item insert failed — no row returned')
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
        throw inboxError('not_found', 'Inbox item status update failed — no row returned')
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
        throw inboxError(
          'not_found',
          'Inbox item assignment update failed — no row returned',
        )
      }
      return withDefaults(result[0])
    })
  },

  countByStatus: async (
    orgId: OrganizationId,
    status: InboxStatus,
    propertyIds?: ReadonlyArray<PropertyId>,
  ) => {
    return trace('inbox.countByStatus', async () => {
      const conditions: SQL[] = [
        eq(inboxItems.organizationId, orgId),
        eq(inboxItems.status, status),
      ]
      if (propertyIds && propertyIds.length > 0) {
        conditions.push(inArray(inboxItems.propertyId, [...propertyIds] as string[]))
      }
      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(inboxItems)
        .where(and(...conditions))
      return Number(result[0]?.count ?? 0)
    })
  },
  setEscalation: async (
    id: InboxItemId,
    orgId: OrganizationId,
    escalatedBy: UserId,
    now?: Date,
  ) => {
    return trace('inbox.setEscalation', async () => {
      const stamp = now ?? new Date()
      const result = await db
        .update(inboxItems)
        .set({
          isEscalated: true,
          escalatedAt: stamp,
          escalatedBy,
          escalationResolvedAt: null,
          escalationResolvedBy: null,
          updatedAt: stamp,
        })
        .where(and(eq(inboxItems.id, id), eq(inboxItems.organizationId, orgId)))
        .returning()
      if (!result[0]) {
        throw inboxError(
          'not_found',
          'Inbox item escalation update failed — no row returned',
        )
      }
      return withDefaults(result[0])
    })
  },
  resolveEscalation: async (
    id: InboxItemId,
    orgId: OrganizationId,
    resolvedBy: UserId,
    now?: Date,
  ) => {
    return trace('inbox.resolveEscalation', async () => {
      const stamp = now ?? new Date()
      const result = await db
        .update(inboxItems)
        .set({
          isEscalated: false,
          escalationResolvedAt: stamp,
          escalationResolvedBy: resolvedBy,
          updatedAt: stamp,
        })
        .where(and(eq(inboxItems.id, id), eq(inboxItems.organizationId, orgId)))
        .returning()
      if (!result[0]) {
        throw inboxError(
          'not_found',
          'Inbox item resolve-escalation failed — no row returned',
        )
      }
      return withDefaults(result[0])
    })
  },
  countEscalatedActive: async (
    orgId: OrganizationId,
    propertyIds?: ReadonlyArray<PropertyId>,
  ) => {
    return trace('inbox.countEscalatedActive', async () => {
      const conditions: SQL[] = [
        eq(inboxItems.organizationId, orgId),
        eq(inboxItems.isEscalated, true),
        isNull(inboxItems.escalationResolvedAt),
      ]
      if (propertyIds && propertyIds.length > 0) {
        conditions.push(inArray(inboxItems.propertyId, [...propertyIds] as string[]))
      }
      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(inboxItems)
        .where(and(...conditions))
      return Number(result[0]?.count ?? 0)
    })
  },
  countOpenSince: async (
    orgId: OrganizationId,
    since: Date | null,
    propertyIds?: ReadonlyArray<PropertyId>,
  ) => {
    return trace('inbox.countOpenSince', async () => {
      const conditions: SQL[] = [
        eq(inboxItems.organizationId, orgId),
        eq(inboxItems.status, 'open'),
      ]
      if (since) conditions.push(gte(inboxItems.createdAt, since))
      if (propertyIds && propertyIds.length > 0) {
        conditions.push(inArray(inboxItems.propertyId, [...propertyIds] as string[]))
      }
      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(inboxItems)
        .where(and(...conditions))
      return Number(result[0]?.count ?? 0)
    })
  },

  updateSourceMeta: async (
    id: InboxItemId,
    orgId: OrganizationId,
    fields: Readonly<{ sourceDate: Date; platform: string | null }>,
    now?: Date,
  ) => {
    return trace('inbox.updateSourceMeta', async () => {
      const result = await db
        .update(inboxItems)
        .set({
          sourceDate: fields.sourceDate,
          platform: fields.platform,
          updatedAt: now ?? new Date(),
        })
        .where(and(eq(inboxItems.id, id), eq(inboxItems.organizationId, orgId)))
        .returning()
      return result[0] ? withDefaults(result[0]) : null
    })
  },

  scanReviewItems: async (
    orgId: OrganizationId,
    opts: Readonly<{ propertyId?: PropertyId; cursor?: InboxItemId; limit: number }>,
  ) => {
    return trace('inbox.scanReviewItems', async () => {
      const conditions: SQL[] = [
        eq(inboxItems.organizationId, orgId),
        eq(inboxItems.sourceType, 'review'),
      ]
      if (opts.propertyId) conditions.push(eq(inboxItems.propertyId, opts.propertyId))
      if (opts.cursor) conditions.push(gt(inboxItems.id, opts.cursor))
      const rows = await db
        .select()
        .from(inboxItems)
        .where(and(...conditions))
        .orderBy(inboxItems.id)
        .limit(opts.limit)
      return rows.map(withDefaults)
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

      if (item.sourceType === 'review') {
        // BQC-1.2: content comes only from the eligibility-enforcing lookup;
        // expired/missing yields a typed status, never stale fields.
        const result = await ports.reviewLookup.getReviewSnippetById(
          reviewId(item.sourceId),
          orgId,
        )
        const snippet = result.status === 'available' ? result.snippet : null
        log.debug(
          {
            id: id as string,
            orgId: orgId as string,
            contentStatus: result.status,
            duration: Date.now() - start,
          },
          'inbox findDetailById review enrichment',
        )
        return {
          item: { ...item, propertyName, reviewerName: snippet?.reviewerName ?? null },
          reviewText: snippet?.text ?? null,
          reviewerProfilePhotoUrl: snippet?.reviewerProfilePhotoUrl ?? null,
          reviewContentStatus: result.status,
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
        item: { ...item, propertyName, reviewerName: null },
        reviewText: null,
        reviewerProfilePhotoUrl: null,
        reviewContentStatus: null,
        feedbackComment: snippet?.comment ?? null,
        feedbackRatingValue: snippet?.ratingValue ?? null,
      }
    })
  },
})

/** Builds the WHERE conditions for the inbox list query. Returns `null` when
 *  the filter is provably empty (an empty propertyIds list matches no rows). */
const buildFilterConditions = (
  filters: InboxFilters,
  orgId: OrganizationId,
): SQL[] | null => {
  const conditions: SQL[] = [eq(inboxItems.organizationId, orgId)]

  // Property filter — an empty propertyIds list provably matches no rows.
  if (filters.propertyIds?.length === 0) return null
  if (filters.propertyId) conditions.push(eq(inboxItems.propertyId, filters.propertyId))
  else if (filters.propertyIds)
    conditions.push(inArray(inboxItems.propertyId, [...filters.propertyIds] as string[]))

  // Status filter — single value or set
  if (filters.status)
    conditions.push(
      typeof filters.status === 'string'
        ? eq(inboxItems.status, filters.status)
        : inArray(inboxItems.status, [...filters.status] as InboxStatus[]),
    )

  // Escalation flag filter (Escalated folder shows active flags)
  if (filters.isEscalated !== undefined) {
    conditions.push(eq(inboxItems.isEscalated, filters.isEscalated))
    if (filters.isEscalated) {
      conditions.push(isNull(inboxItems.escalationResolvedAt))
    }
  }

  // Simple equality / range filters
  if (filters.sourceType) conditions.push(eq(inboxItems.sourceType, filters.sourceType))
  if (filters.platform) conditions.push(eq(inboxItems.platform, filters.platform))
  // BQC-1.2: rating range and free-text search are applied via
  // reviewLookup.findEligibleReviewIds at the call site — never against
  // denormalized copies.
  if (filters.sourceDateFrom)
    conditions.push(gte(inboxItems.sourceDate, filters.sourceDateFrom))
  if (filters.sourceDateTo)
    conditions.push(lte(inboxItems.sourceDate, filters.sourceDateTo))

  return conditions
}

// ── Batch helpers ──────────────────────────────────────────────────

async function batchReviewSnippets(
  ports: LookupPorts,
  sourceIds: string[],
  orgId: OrganizationId,
): Promise<ReadonlyMap<string, ReviewSnippet>> {
  if (sourceIds.length === 0) return new Map<string, ReviewSnippet>()
  return ports.reviewLookup.getReviewSnippetsByIds(sourceIds.map(reviewId), orgId)
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
