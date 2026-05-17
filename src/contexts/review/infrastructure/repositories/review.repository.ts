// Review context — Drizzle review repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Reviews table has no deletedAt column, so baseWhere is not used.
//
// Query limits:
//   500  — findByPropertyId, findAllByOrganization: per-request page size. Matches typical
//          GBP location review counts (<500 for most businesses). Paginate if exceeded.
//   5000 — findAllExpiringBefore, findAllExpiredBefore: system-level batch queries for
//          scheduled jobs. No tenant filter — designed to scan all orgs in one pass.
//          If total reviews exceed ~5K, these jobs need cursor-based pagination.

import { and, eq, lte, lt } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { reviews } from '#/shared/db/schema/review.schema'
import type { ReviewRepository } from '../../application/ports/review.repository'
import type { Review, ReviewPlatform } from '../../domain/types'
import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import { reviewFromRow, reviewToRow } from '../mappers/review.mapper'
import { trace } from '#/shared/observability/trace'

export const createReviewRepository = (db: Database): ReviewRepository => ({
  findByExternalId: async (platform: ReviewPlatform, externalId: string, organizationId: OrganizationId) => {
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

  upsert: async (review: Omit<Review, 'createdAt' | 'updatedAt'>) => {
    return trace('review.upsert', async () => {
      const row = reviewToRow(review)
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
            updatedAt: new Date(),
          },
        })
        .returning()

      if (!result[0]) {
        throw new Error('Review upsert failed — no row returned')
      }
      return reviewFromRow(result[0])
    })
  },

  findByPropertyId: async (propertyId: PropertyId, organizationId: OrganizationId) => {
    return trace('review.findByPropertyId', async () => {
      const rows = await db
        .select()
        .from(reviews)
        .where(
          and(
            eq(reviews.propertyId, propertyId),
            eq(reviews.organizationId, organizationId),
          ),
        )
        .limit(500)
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

  /** Reviews where expiresAt <= date (inclusive). System-level query — no tenant filter by design. */
  findAllExpiringBefore: async (date: Date) => {
    return trace('review.findAllExpiringBefore', async () => {
      const rows = await db
        .select()
        .from(reviews)
        .where(lte(reviews.expiresAt, date))
        .limit(5000)
      return rows.map(reviewFromRow)
    })
  },

  /** Reviews where expiresAt < date (exclusive). System-level query — no tenant filter by design. Used by purge job with 3-day grace period. */
  findAllExpiredBefore: async (date: Date) => {
    return trace('review.findAllExpiredBefore', async () => {
      const rows = await db
        .select()
        .from(reviews)
        .where(lt(reviews.expiresAt, date))
        .limit(5000)
      return rows.map(reviewFromRow)
    })
  },

  deleteById: async (id: ReviewId, organizationId: OrganizationId) => {
    return trace('review.deleteById', async () => {
      await db.delete(reviews).where(
        and(eq(reviews.id, id), eq(reviews.organizationId, organizationId)),
      )
    })
  },

  deleteByPropertyId: async (propertyId: PropertyId, organizationId: OrganizationId) => {
    return trace('review.deleteByPropertyId', async () => {
      await db.delete(reviews).where(
        and(eq(reviews.propertyId, propertyId), eq(reviews.organizationId, organizationId)),
      )
    })
  },
})
