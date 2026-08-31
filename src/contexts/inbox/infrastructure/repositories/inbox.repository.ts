// Inbox context — Drizzle inbox repository implementation
// Per architecture: factory function returning Readonly<{ method }>).
// Wrapped in trace() for observability.
//
// Cross-context data (review/feedback/property) is fetched via lookup ports
// defined in application/ports/ — never via direct table JOINs.

import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { inboxHandlingCycleHeads, inboxItems } from '#/shared/db/schema/inbox.schema'
import type {
  InboxRepository,
  InboxFilters,
  InboxSourceScope,
  Cursor,
  PaginatedResult,
} from '../../application/ports/inbox.repository'
import type {
  ReviewLookupPort,
  ReviewSnippet,
} from '../../application/ports/review-lookup.port'
import type {
  FeedbackLookupPort,
  FeedbackSnippet,
} from '../../application/ports/feedback-lookup.port'
import type { PropertyLookupPort } from '../../application/ports/property-lookup.port'
import type { AiReviewInsightsPort } from '../../application/ports/ai-review-insights.port'
import type { InboxItem, InboxStatus, SourceType } from '../../domain/types'
import type {
  InboxItemId,
  FeedbackId,
  OrganizationId,
  PropertyId,
  ReviewId,
  UserId,
} from '#/shared/domain/ids'
import { reviewId, feedbackId, propertyId } from '#/shared/domain/ids'
import { inboxItemFromRow, inboxItemToInsertRow } from '../mappers/inbox.mapper'
import { trace } from '#/shared/observability/trace'
import { inboxError } from '../../domain/errors'

type InboxItemRow = Parameters<typeof inboxItemFromRow>[0]

type LookupPorts = Readonly<{
  reviewLookup: ReviewLookupPort
  feedbackLookup: FeedbackLookupPort
  propertyLookup: PropertyLookupPort
  aiInsights?: AiReviewInsightsPort
}>

export type InboxRepositoryRuntime = Readonly<{
  clock: () => Date
  logger: LoggerPort
}>

const withDefaults = (row: InboxItemRow): InboxItem => ({
  ...inboxItemFromRow(row),
  propertyName: null,
})

/**
 * Source rows are actionable only through their canonical Handling Cycle
 * head. Every active read uses the same exact tenant/property/source identity
 * join; an orphan or mismatched compatibility projection is deliberately
 * invisible. `findBySource` remains the raw repair/materialization seam.
 */
const activeHandlingCycleJoin = and(
  eq(inboxHandlingCycleHeads.inboxItemId, inboxItems.id),
  eq(inboxHandlingCycleHeads.organizationId, inboxItems.organizationId),
  sql`${inboxHandlingCycleHeads.propertyId}::text = ${inboxItems.propertyId}`,
  eq(inboxHandlingCycleHeads.sourceType, inboxItems.sourceType),
  eq(inboxHandlingCycleHeads.sourceId, inboxItems.sourceId),
)

const hasActiveHandlingAuthority = isNotNull(inboxHandlingCycleHeads.inboxItemId)

const effectiveInboxStatus = sql<InboxStatus>`${inboxHandlingCycleHeads.status}`

const activeInboxItemColumns = {
  ...getTableColumns(inboxItems),
  status: effectiveInboxStatus,
}

/**
 * Match source ids with one PostgreSQL array parameter. Content and AI
 * lookups can legitimately return thousands of ids; expanding them through
 * `inArray` would consume one bind parameter per id and eventually exceed the
 * PostgreSQL parameter ceiling.
 */
export function inboxSourceIdMatchesAny(ids: ReadonlyArray<string>): SQL {
  if (ids.length === 0) return sql`false`
  return sql`${inboxItems.sourceId} = ANY(${sql.param(ids.map(String))}::uuid[])`
}

/** Mutable set-values for an inbox_items update. */
type InboxItemSet = Partial<typeof inboxItems.$inferInsert>

/**
 * Update one inbox item by id+org, throwing not_found with `notFoundMessage`
 * when the row vanished (single source for the update+guard shape, BQC-5.9 E14).
 */
async function updateByIdAndOrg(
  db: Database,
  id: InboxItemId,
  orgId: OrganizationId,
  set: InboxItemSet,
  notFoundMessage: string,
): Promise<InboxItem> {
  const result = await db
    .update(inboxItems)
    .set({
      ...set,
      commandRevision: sql<number>`${inboxItems.commandRevision} + 1`,
    })
    .where(and(eq(inboxItems.id, id), eq(inboxItems.organizationId, orgId)))
    .returning()
  if (!result[0]) {
    throw inboxError('not_found', notFoundMessage)
  }
  return withDefaults(result[0])
}

/**
 * Count inbox items matching `conditions`, optionally narrowed to a property
 * set (single source for the count-with-optional-property-filter shape).
 */
async function countWhere(
  db: Database,
  orgId: OrganizationId,
  propertyIds: ReadonlyArray<PropertyId> | undefined,
  sourceScopes: ReadonlyArray<InboxSourceScope> | undefined,
  ...conditions: SQL[]
): Promise<number> {
  if (propertyIds?.length === 0 || sourceScopes?.length === 0) return 0
  const all: SQL[] = [eq(inboxItems.organizationId, orgId), ...conditions]
  if (propertyIds) {
    all.push(inArray(inboxItems.propertyId, [...propertyIds] as string[]))
  }
  const sourceScope = sourceScopeCondition(sourceScopes)
  if (sourceScope === null) return 0
  if (sourceScope) {
    all.push(sourceScope)
  }
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(inboxItems)
    .leftJoin(inboxHandlingCycleHeads, activeHandlingCycleJoin)
    .where(and(hasActiveHandlingAuthority, ...all))
  return Number(result[0]?.count ?? 0)
}

/**
 * AI-derived narrowing for the item list: `attention` and `category`.
 *
 * Neither is a column on `inbox_items`. Each active filter resolves to the
 * review ids whose CURRENT analysis matches, through the AI context's gated
 * projection, and contributes its own `IN` predicate — so supplying both
 * intersects them rather than unioning them.
 *
 * Returns `null` to mean "stop, nothing can match". An absent AI port or an
 * empty id set is "no review matches", NEVER "no filter": treating it as the
 * latter would show the entire inbox while the UI claimed a filter was applied.
 */
async function resolveAiNarrowing(
  ports: LookupPorts,
  orgId: OrganizationId,
  filters: InboxFilters,
): Promise<SQL[] | null> {
  if (!filters.attention?.length && !filters.category?.length) return []
  const propertyIds =
    filters.propertyIds ?? (filters.propertyId ? [filters.propertyId] : undefined)
  const lookups: Array<Promise<readonly ReviewId[]> | undefined> = []
  if (filters.attention?.length) {
    lookups.push(
      ports.aiInsights?.findCurrentReviewIdsByAttention({
        organizationId: orgId,
        propertyIds,
        attention: filters.attention,
      }),
    )
  }
  if (filters.category?.length) {
    lookups.push(
      ports.aiInsights?.findCurrentReviewIdsByCategory({
        organizationId: orgId,
        propertyIds,
        categories: filters.category,
      }),
    )
  }
  const narrowing: SQL[] = [eq(inboxItems.sourceType, 'review')]
  for (const reviewIds of await Promise.all(lookups)) {
    if (reviewIds === undefined || reviewIds.length === 0) return null
    narrowing.push(inboxSourceIdMatchesAny(reviewIds))
  }
  return narrowing
}

/** Resolve rating/text predicates against each source's owning content store. */
async function resolveContentNarrowing(
  ports: LookupPorts,
  orgId: OrganizationId,
  filters: InboxFilters,
): Promise<SQL[] | null> {
  if (filters.ratingMin === undefined && filters.ratingMax === undefined && !filters.q) {
    return []
  }
  const contentFilter = {
    ratingMin: filters.ratingMin,
    ratingMax: filters.ratingMax,
    textQuery: filters.q,
  }
  const [reviewIds, feedbackIds] = await Promise.all([
    filters.sourceType === 'feedback'
      ? Promise.resolve([])
      : ports.reviewLookup.findEligibleReviewIds(orgId, contentFilter),
    filters.sourceType === 'review'
      ? Promise.resolve([])
      : ports.feedbackLookup.findEligibleFeedbackIds(orgId, contentFilter),
  ])
  const sourceMatches: SQL[] = []
  if (reviewIds.length > 0) {
    sourceMatches.push(
      and(eq(inboxItems.sourceType, 'review'), inboxSourceIdMatchesAny(reviewIds))!,
    )
  }
  if (feedbackIds.length > 0) {
    sourceMatches.push(
      and(eq(inboxItems.sourceType, 'feedback'), inboxSourceIdMatchesAny(feedbackIds))!,
    )
  }
  if (sourceMatches.length === 0) return null
  return [sourceMatches.length === 1 ? sourceMatches[0]! : or(...sourceMatches)!]
}

export const createInboxRepository = (
  db: Database,
  ports: LookupPorts,
  runtime: InboxRepositoryRuntime,
): InboxRepository => {
  const log = runtime.logger.child({ component: 'inbox-repo' })

  return {
    findById: async (id: InboxItemId, orgId: OrganizationId) => {
      return trace('inbox.findById', async () => {
        const start = runtime.clock().getTime()
        log.debug('querying inbox findById')
        const rows = await db
          .select(activeInboxItemColumns)
          .from(inboxItems)
          .leftJoin(inboxHandlingCycleHeads, activeHandlingCycleJoin)
          .where(
            and(
              hasActiveHandlingAuthority,
              eq(inboxItems.id, id),
              eq(inboxItems.organizationId, orgId),
            ),
          )
          .limit(1)
        log.debug(
          { duration: runtime.clock().getTime() - start },
          'inbox findById complete',
        )
        return rows[0] ? withDefaults(rows[0]) : null
      })
    },

    findByIds: async (ids: ReadonlyArray<InboxItemId>, orgId: OrganizationId) => {
      return trace('inbox.findByIds', async () => {
        if (ids.length === 0) return []
        const rows = await db
          .select(activeInboxItemColumns)
          .from(inboxItems)
          .leftJoin(inboxHandlingCycleHeads, activeHandlingCycleJoin)
          .where(
            and(
              hasActiveHandlingAuthority,
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
        const start = runtime.clock().getTime()
        log.debug({ limit }, 'querying inbox findFilteredPaginated')
        const conditions = buildFilterConditions(filters, orgId)
        if (conditions === null)
          return { items: [], nextCursor: null, totalCount: 0 } as PaginatedResult

        // Rating/text predicates are resolved by each source-owning context.
        // Source type is correlated with each id set so a UUID collision between
        // storage generations cannot leak or falsely match another source.
        const contentNarrowing = await resolveContentNarrowing(ports, orgId, filters)
        if (contentNarrowing === null)
          return { items: [], nextCursor: null, totalCount: 0 } as PaginatedResult
        conditions.push(...contentNarrowing)
        // AI-derived narrowing (attention / category). Extracted because adding
        // the second filter pushed this function past the complexity threshold.
        const aiNarrowing = await resolveAiNarrowing(ports, orgId, filters)
        if (aiNarrowing === null)
          return { items: [], nextCursor: null, totalCount: 0 } as PaginatedResult
        conditions.push(...aiNarrowing)

        const pageConditions = [...conditions]
        const sort = filters.sort ?? 'newest'

        // Cursor-based pagination: sourceDate DESC, id DESC
        // The tuple comparison mirrors the selected ordering so page boundaries
        // remain stable even when several reviews share the same source date.
        if (cursor) {
          pageConditions.push(
            sort === 'newest'
              ? sql`(${inboxItems.sourceDate}, ${inboxItems.id}) < (${cursor.sourceDate}, ${cursor.id})`
              : sql`(${inboxItems.sourceDate}, ${inboxItems.id}) > (${cursor.sourceDate}, ${cursor.id})`,
          )
        }

        // Count and page use the same governed filter predicates. The count is
        // intentionally evaluated before the cursor predicate.
        const [countRows, rows] = await Promise.all([
          db
            .select({ count: sql<number>`count(*)` })
            .from(inboxItems)
            .leftJoin(inboxHandlingCycleHeads, activeHandlingCycleJoin)
            .where(and(...conditions)),
          db
            .select(activeInboxItemColumns)
            .from(inboxItems)
            .leftJoin(inboxHandlingCycleHeads, activeHandlingCycleJoin)
            .where(and(...pageConditions))
            .orderBy(
              ...(sort === 'newest'
                ? [desc(inboxItems.sourceDate), desc(inboxItems.id)]
                : [asc(inboxItems.sourceDate), asc(inboxItems.id)]),
            )
            .limit(limit + 1),
        ])
        const totalCount = Number(countRows[0]?.count ?? 0)

        const sliced = rows.slice(0, limit)

        // Enrich with live eligible review content + property names (batch)
        const reviewIdsToFetch = sliced
          .filter((r) => r.sourceType === 'review')
          .map((r) => r.sourceId)
        const feedbackIdsToFetch = sliced
          .filter((r) => r.sourceType === 'feedback')
          .map((r) => feedbackId(r.sourceId))

        const propertyIdsToFetch = [...new Set(sliced.map((r) => r.propertyId))]

        const [reviewSnippets, feedbackSnippets, propertyNames, urgentReviewIds] =
          await Promise.all([
            batchReviewSnippets(ports, reviewIdsToFetch, orgId),
            batchFeedbackSnippets(ports, feedbackIdsToFetch, orgId),
            batchPropertyNames(ports, propertyIdsToFetch, orgId),
            findUrgentReviewIds(ports, reviewIdsToFetch, propertyIdsToFetch, orgId),
          ])
        const urgentSet = new Set(urgentReviewIds)

        const items = sliced.map((row) => {
          const item = inboxItemFromRow(row)
          // BQC-1.2: rating/snippet/reviewerName come only from the live
          // eligible lookup — expired/missing content renders as nulls.
          const review =
            row.sourceType === 'review' ? reviewSnippets.get(row.sourceId) : undefined
          const feedback =
            row.sourceType === 'feedback' ? feedbackSnippets.get(row.sourceId) : undefined
          const text = row.sourceType === 'review' ? review?.text : feedback?.comment
          const rating =
            row.sourceType === 'review' ? review?.rating : feedback?.ratingValue
          const hasText = typeof text === 'string' && text.trim().length > 0
          const contentAvailability = hasText
            ? ('text' as const)
            : rating !== null && rating !== undefined
              ? ('rating_only' as const)
              : ('unavailable' as const)
          return {
            ...item,
            rating: rating ?? null,
            snippet: hasText ? text! : null,
            contentAvailability,
            reviewerName: review?.reviewerName ?? null,
            propertyName: propertyNames.get(row.propertyId) ?? null,
            reviewLanguageCode: review?.languageCode ?? null,
            attention:
              row.sourceType === 'review' && urgentSet.has(reviewId(row.sourceId))
                ? ('urgent' as const)
                : null,
          }
        })

        const hasNext = rows.length > limit
        const lastItem = items[items.length - 1]

        const nextCursor: Cursor | null =
          hasNext && lastItem
            ? { sourceDate: lastItem.sourceDate, id: lastItem.id }
            : null

        log.debug(
          {
            itemCount: items.length,
            hasNext,
            duration: runtime.clock().getTime() - start,
          },
          'inbox findFilteredPaginated complete',
        )

        return { items, nextCursor, totalCount } as PaginatedResult
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
        return updateByIdAndOrg(
          db,
          id,
          orgId,
          {
            status,
            updatedAt: now ?? runtime.clock(),
            ...timestampFields,
          },
          'Inbox item status update failed — no row returned',
        )
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
            commandRevision: sql<number>`${inboxItems.commandRevision} + 1`,
            updatedAt: now ?? runtime.clock(),
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

    stampReplyMilestones: async (
      id: InboxItemId,
      orgId: OrganizationId,
      milestones: Readonly<{
        firstReplySubmittedAt?: Date
        firstReplyPublishedAt?: Date
      }>,
      now?: Date,
    ) => {
      return trace('inbox.stampReplyMilestones', async () => {
        // No `status` key is constructible here — that is the whole point.
        const result = await db
          .update(inboxItems)
          .set({
            ...milestones,
            commandRevision: sql<number>`${inboxItems.commandRevision} + 1`,
            updatedAt: now ?? runtime.clock(),
          })
          .where(and(eq(inboxItems.id, id), eq(inboxItems.organizationId, orgId)))
          .returning()
        return result[0] ? withDefaults(result[0]) : null
      })
    },

    updateAssignment: async (
      id: InboxItemId,
      orgId: OrganizationId,
      assignedTo: UserId | null,
      now?: Date,
    ) => {
      return trace('inbox.updateAssignment', async () => {
        return updateByIdAndOrg(
          db,
          id,
          orgId,
          {
            assignedTo,
            updatedAt: now ?? runtime.clock(),
          },
          'Inbox item assignment update failed — no row returned',
        )
      })
    },

    countByStatus: async (
      orgId: OrganizationId,
      status: InboxStatus,
      propertyIds?: ReadonlyArray<PropertyId>,
      sourceScopes?: ReadonlyArray<InboxSourceScope>,
    ) => {
      return trace('inbox.countByStatus', async () => {
        return countWhere(
          db,
          orgId,
          propertyIds,
          sourceScopes,
          sql`${effectiveInboxStatus} = ${status}`,
        )
      })
    },
    setEscalation: async (
      id: InboxItemId,
      orgId: OrganizationId,
      escalatedBy: UserId,
      now?: Date,
    ) => {
      return trace('inbox.setEscalation', async () => {
        const stamp = now ?? runtime.clock()
        return updateByIdAndOrg(
          db,
          id,
          orgId,
          {
            isEscalated: true,
            escalatedAt: stamp,
            escalatedBy,
            escalationResolvedAt: null,
            escalationResolvedBy: null,
            updatedAt: stamp,
          },
          'Inbox item escalation update failed — no row returned',
        )
      })
    },
    resolveEscalation: async (
      id: InboxItemId,
      orgId: OrganizationId,
      resolvedBy: UserId,
      now?: Date,
    ) => {
      return trace('inbox.resolveEscalation', async () => {
        const stamp = now ?? runtime.clock()
        return updateByIdAndOrg(
          db,
          id,
          orgId,
          {
            isEscalated: false,
            escalationResolvedAt: stamp,
            escalationResolvedBy: resolvedBy,
            updatedAt: stamp,
          },
          'Inbox item resolve-escalation failed — no row returned',
        )
      })
    },
    countEscalatedActive: async (
      orgId: OrganizationId,
      propertyIds?: ReadonlyArray<PropertyId>,
      sourceScopes?: ReadonlyArray<InboxSourceScope>,
    ) => {
      return trace('inbox.countEscalatedActive', async () => {
        return countWhere(
          db,
          orgId,
          propertyIds,
          sourceScopes,
          eq(inboxItems.isEscalated, true),
          isNull(inboxItems.escalationResolvedAt),
        )
      })
    },
    countOpenSince: async (
      orgId: OrganizationId,
      since: Date | null,
      propertyIds?: ReadonlyArray<PropertyId>,
      sourceScopes?: ReadonlyArray<InboxSourceScope>,
    ) => {
      return trace('inbox.countOpenSince', async () => {
        const conditions: SQL[] = [sql`${effectiveInboxStatus} = 'open'`]
        if (since) conditions.push(gte(inboxItems.createdAt, since))
        return countWhere(db, orgId, propertyIds, sourceScopes, ...conditions)
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
            commandRevision: sql<number>`${inboxItems.commandRevision} + 1`,
            updatedAt: now ?? runtime.clock(),
          })
          .where(and(eq(inboxItems.id, id), eq(inboxItems.organizationId, orgId)))
          .returning()
        return result[0] ? withDefaults(result[0]) : null
      })
    },

    clearReviewSourceContent: async (id, orgId, now) => {
      return trace('inbox.clearReviewSourceContent', async () => {
        const result = await db
          .update(inboxItems)
          .set({
            rating: null,
            snippet: null,
            reviewerName: null,
            commandRevision: sql<number>`LEAST(
            ${inboxItems.commandRevision} + 1,
            '9007199254740991'::bigint
          )`,
            updatedAt: now ?? runtime.clock(),
          })
          .where(
            and(
              eq(inboxItems.id, id),
              eq(inboxItems.organizationId, orgId),
              eq(inboxItems.sourceType, 'review'),
            ),
          )
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
        const start = runtime.clock().getTime()
        log.debug('querying inbox findDetailById')
        const rows = await db
          .select(activeInboxItemColumns)
          .from(inboxItems)
          .leftJoin(inboxHandlingCycleHeads, activeHandlingCycleJoin)
          .where(
            and(
              hasActiveHandlingAuthority,
              eq(inboxItems.id, id),
              eq(inboxItems.organizationId, orgId),
            ),
          )
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
              contentStatus: result.status,
              duration: runtime.clock().getTime() - start,
            },
            'inbox findDetailById review enrichment',
          )
          return {
            item: {
              ...item,
              propertyName,
              reviewerName: snippet?.reviewerName ?? null,
              reviewLanguageCode: snippet?.languageCode ?? null,
            },
            reviewText: snippet?.text ?? null,
            reviewTranslatedText: snippet?.translatedText ?? null,
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
          { duration: runtime.clock().getTime() - start },
          'inbox findDetailById complete',
        )
        return {
          item: { ...item, propertyName, reviewerName: null },
          reviewText: null,
          reviewTranslatedText: null,
          reviewerProfilePhotoUrl: null,
          reviewContentStatus: null,
          feedbackComment: snippet?.comment ?? null,
          feedbackRatingValue: snippet?.ratingValue ?? null,
        }
      })
    },
  }
}

/** Builds the WHERE conditions for the inbox list query. Returns `null` when
 *  the filter is provably empty (an empty propertyIds list matches no rows). */
const buildFilterConditions = (
  filters: InboxFilters,
  orgId: OrganizationId,
): SQL[] | null => {
  const conditions: SQL[] = [
    eq(inboxItems.organizationId, orgId),
    hasActiveHandlingAuthority,
  ]

  // Property filter — an empty propertyIds list provably matches no rows.
  if (filters.propertyIds?.length === 0) return null
  if (filters.propertyId) conditions.push(eq(inboxItems.propertyId, filters.propertyId))
  else if (filters.propertyIds)
    conditions.push(inArray(inboxItems.propertyId, [...filters.propertyIds] as string[]))

  const sourceScope = sourceScopeCondition(filters.sourceScopes)
  if (sourceScope === null) return null
  if (sourceScope) conditions.push(sourceScope)

  // Status filter — single value or set
  if (filters.status)
    conditions.push(
      typeof filters.status === 'string'
        ? sql`${effectiveInboxStatus} = ${filters.status}`
        : sql`${effectiveInboxStatus} = ANY(${sql.param([...filters.status])}::inbox_status[])`,
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

/** Build the OR-of-source/property authorization predicate. */
const sourceScopeCondition = (
  sourceScopes: ReadonlyArray<InboxSourceScope> | undefined,
): SQL | null | undefined => {
  if (sourceScopes === undefined) return undefined
  const predicates = sourceScopes.flatMap((scope) => {
    if (scope.propertyIds?.length === 0) return []
    const source = eq(inboxItems.sourceType, scope.sourceType)
    return scope.propertyIds === undefined
      ? [source]
      : [and(source, inArray(inboxItems.propertyId, [...scope.propertyIds] as string[]))!]
  })
  if (predicates.length === 0) return null
  return predicates.length === 1 ? predicates[0] : or(...predicates)
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

async function batchFeedbackSnippets(
  ports: LookupPorts,
  sourceIds: ReadonlyArray<FeedbackId>,
  orgId: OrganizationId,
): Promise<ReadonlyMap<string, FeedbackSnippet>> {
  if (sourceIds.length === 0) return new Map<string, FeedbackSnippet>()
  return ports.feedbackLookup.getFeedbackSnippetsByIds(sourceIds, orgId)
}

async function findUrgentReviewIds(
  ports: LookupPorts,
  sourceIds: string[],
  propertyIds: string[],
  orgId: OrganizationId,
): Promise<readonly ReviewId[]> {
  if (!ports.aiInsights || sourceIds.length === 0) return []
  return ports.aiInsights.findCurrentReviewIdsByAttention({
    organizationId: orgId,
    propertyIds: propertyIds.map(propertyId),
    reviewIds: sourceIds.map(reviewId),
    attention: ['urgent'],
  })
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
