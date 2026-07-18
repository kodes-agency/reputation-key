// Review context — Drizzle review repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Reviews table has no deletedAt column, so baseWhere is not used.
//
// Query limits:
//   500  — findByPropertyId, findAllByOrganization: per-request page size. Matches typical
//          GBP location review counts (<500 for most businesses). Paginate if exceeded.
//   5000 — findAllExpiringBeforeAcrossTenants, findAllExpiredBeforeAcrossTenants: system-level
//          batch queries for scheduled jobs. No tenant filter — designed to scan all orgs in
//          one pass. If total reviews exceed ~5K, these jobs need cursor-based pagination.

import {
  and,
  asc,
  eq,
  lte,
  lt,
  gt,
  gte,
  inArray,
  desc,
  isNotNull,
  sql,
} from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { reviews } from '#/shared/db/schema/review.schema'
import type { ReviewRepository } from '../../application/ports/review.repository'
import type { Review, ReviewPlatform } from '../../domain/types'
import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import { reviewFromRow, reviewToRow } from '../mappers/review.mapper'
import { reviewError } from '../../domain/errors'
import { trace } from '#/shared/observability/trace'
export const createReviewRepository = (db: Database): ReviewRepository => ({
  findById: async (id: ReviewId, organizationId: OrganizationId) => {
    return trace('review.findById', async () => {
      const rows = await db
        .select()
        .from(reviews)
        .where(and(eq(reviews.id, id), eq(reviews.organizationId, organizationId)))
        .limit(1)
      return rows[0] ? reviewFromRow(rows[0]) : null
    })
  },

  findByIds: async (ids: ReadonlyArray<ReviewId>, organizationId: OrganizationId) => {
    return trace('review.findByIds', async () => {
      if (ids.length === 0) return []
      const rows = await db
        .select()
        .from(reviews)
        .where(
          and(inArray(reviews.id, [...ids]), eq(reviews.organizationId, organizationId)),
        )
      return rows.map((r) => reviewFromRow(r))
    })
  },

  findByExternalId: async (
    platform: ReviewPlatform,
    externalId: string,
    organizationId: OrganizationId,
  ) => {
    return trace('review.findByExternalId', async () => {
      const rows = await db
        .select()
        .from(reviews)
        .where(
          and(
            eq(reviews.platform, platform),
            eq(reviews.externalId, externalId),
            eq(reviews.organizationId, organizationId),
          ),
        )
        .limit(1)
      return rows[0] ? reviewFromRow(rows[0]) : null
    })
  },

  upsert: async (review: Omit<Review, 'createdAt' | 'updatedAt'>, now?: Date) => {
    return trace('review.upsert', async () => {
      const row = reviewToRow(review)
      const updatedAt = now ?? new Date()
      const result = await db
        .insert(reviews)
        .values(row)
        .onConflictDoUpdate({
          target: [reviews.platform, reviews.externalId, reviews.organizationId],
          set: {
            propertyId: row.propertyId,
            externalLocationId: row.externalLocationId,
            googleConnectionId: row.googleConnectionId,
            reviewerName: row.reviewerName,
            reviewerProfilePhotoUrl: row.reviewerProfilePhotoUrl,
            rating: row.rating,
            text: row.text,
            languageCode: row.languageCode,
            reviewedAt: row.reviewedAt,
            expiresAt: row.expiresAt,
            // BQC-1.3: every successful fetch advances the fetch clock and
            // hash/baseline fields (ADR 0031). firstFetchedAt is preserved
            // by omission — only the first observation sets it.
            sourceCreatedAt: row.sourceCreatedAt,
            sourceUpdatedAt: row.sourceUpdatedAt,
            lastFetchedAt: row.lastFetchedAt,
            contentExpiresAt: row.contentExpiresAt,
            contentHash: row.contentHash,
            sourceSeenGeneration: row.sourceSeenGeneration,
            updatedAt,
          },
        })
        .returning()

      if (!result[0]) {
        throw reviewError('repo_upsert_failed', 'Review upsert failed — no row returned')
      }
      return reviewFromRow(result[0])
    })
  },

  findByPropertyId: async (propertyId, organizationId, options) => {
    return trace('review.findByPropertyId', async () => {
      const query = db
        .select()
        .from(reviews)
        .where(
          and(
            eq(reviews.propertyId, propertyId),
            eq(reviews.organizationId, organizationId),
          ),
        )
        .orderBy(desc(reviews.reviewedAt))

      // F038: Support LIMIT pushdown instead of fetching 500 rows and sorting in JS
      const limit = options?.limit ?? 500
      const rows = await query.limit(limit)
      return rows.map(reviewFromRow)
    })
  },

  /**
   * BQC-1.4: serving read for recent reviews — eligible content only.
   * Eligibility predicate lives in SQL (defense in depth): non-null
   * contentExpiresAt strictly in the future, newest first.
   */
  findRecentEligibleByPropertyId: async (propertyId, organizationId, options, now) => {
    return trace('review.findRecentEligibleByPropertyId', async () => {
      const rows = await db
        .select()
        .from(reviews)
        .where(
          and(
            eq(reviews.propertyId, propertyId),
            eq(reviews.organizationId, organizationId),
            isNotNull(reviews.contentExpiresAt),
            gt(reviews.contentExpiresAt, now),
          ),
        )
        .orderBy(desc(reviews.reviewedAt))
        .limit(options.limit)
      return rows.map(reviewFromRow)
    })
  },

  findByOrganizationId: async (orgId: OrganizationId) => {
    return trace('review.findByOrganizationId', async () => {
      const rows = await db
        .select()
        .from(reviews)
        .where(eq(reviews.organizationId, orgId))
        .limit(500)
      return rows.map(reviewFromRow)
    })
  },

  findByConnection: async (organizationId, connectionId, cursor, limit) => {
    return trace('review.findByConnection', async () => {
      const rows = await db
        .select()
        .from(reviews)
        .where(
          and(
            eq(reviews.organizationId, organizationId),
            eq(reviews.googleConnectionId, connectionId),
            cursor ? gt(reviews.id, cursor.id) : undefined,
          ),
        )
        .orderBy(asc(reviews.id))
        .limit(limit)
      return rows.map(reviewFromRow)
    })
  },

  /**
   * BQC-1.2: eligible content filter for cross-context list queries.
   * Eligibility predicate lives here (defense in depth): non-null
   * contentExpiresAt strictly in the future. Text search escapes LIKE
   * wildcards. Bounded at 1000 ids — page-size guard for list filters.
   */
  findIdsByContentFilter: async (orgId, filter, now) => {
    return trace('review.findIdsByContentFilter', async () => {
      const conditions = [
        eq(reviews.organizationId, orgId),
        isNotNull(reviews.contentExpiresAt),
        gt(reviews.contentExpiresAt, now),
      ]
      if (filter.ratingMin !== undefined)
        conditions.push(gte(reviews.rating, filter.ratingMin))
      if (filter.ratingMax !== undefined)
        conditions.push(lte(reviews.rating, filter.ratingMax))
      if (filter.textQuery) {
        const escaped = filter.textQuery.replace(/%/g, '\\%').replace(/_/g, '\\_')
        conditions.push(sql`${reviews.text} ilike ${'%' + escaped + '%'}`)
      }
      const rows = await db
        .select({ id: reviews.id })
        .from(reviews)
        .where(and(...conditions))
        .limit(1000)
      return rows.map((r) => r.id as string)
    })
  },

  /**
   * ⚠️ CROSS-TENANT: contentExpiresAt <= date (inclusive), non-null only.
   * BQR-3.2: fetch-based clock (ADR 0031), not publication-based expiresAt.
   */
  findAllExpiringBeforeAcrossTenants: async (date: Date) => {
    return trace('review.findAllExpiringBeforeAcrossTenants', async () => {
      const rows = await db
        .select()
        .from(reviews)
        .where(
          and(isNotNull(reviews.contentExpiresAt), lte(reviews.contentExpiresAt, date)),
        )
        .limit(5000)
      return rows.map(reviewFromRow)
    })
  },

  /**
   * BQC-1.5: keyset-bounded batch (contentExpiresAt ASC, id ASC).
   * Cursor predicate is a strict row-tuple greater-than, so concurrent
   * inserts behind the cursor never cause skips or repeats.
   */
  findExpiringBatchAcrossTenants: async (date, cursor, limit) => {
    return trace('review.findExpiringBatchAcrossTenants', async () => {
      const conditions = [
        isNotNull(reviews.contentExpiresAt),
        lte(reviews.contentExpiresAt, date),
      ]
      if (cursor) {
        conditions.push(
          sql`(${reviews.contentExpiresAt}, ${reviews.id}) > (${cursor.contentExpiresAt}, ${cursor.id})`,
        )
      }
      const rows = await db
        .select()
        .from(reviews)
        .where(and(...conditions))
        .orderBy(reviews.contentExpiresAt, reviews.id)
        .limit(limit)
      return rows.map(reviewFromRow)
    })
  },

  /**
   * ⚠️ CROSS-TENANT: contentExpiresAt < date (exclusive), non-null only.
   * BQR-3.2 / ADR 0031: no post-expiry grace — purge as soon as the fetch clock expires.
   */
  findAllExpiredBeforeAcrossTenants: async (date: Date) => {
    return trace('review.findAllExpiredBeforeAcrossTenants', async () => {
      const rows = await db
        .select()
        .from(reviews)
        .where(
          and(isNotNull(reviews.contentExpiresAt), lt(reviews.contentExpiresAt, date)),
        )
        .limit(5000)
      return rows.map(reviewFromRow)
    })
  },

  deleteById: async (id: ReviewId, organizationId: OrganizationId) => {
    return trace('review.deleteById', async () => {
      await db
        .delete(reviews)
        .where(and(eq(reviews.id, id), eq(reviews.organizationId, organizationId)))
    })
  },

  deleteByPropertyId: async (propertyId: PropertyId, organizationId: OrganizationId) => {
    return trace('review.deleteByPropertyId', async () => {
      await db
        .delete(reviews)
        .where(
          and(
            eq(reviews.propertyId, propertyId),
            eq(reviews.organizationId, organizationId),
          ),
        )
    })
  },
})
