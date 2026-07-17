// Review context — review repository port
// Per architecture: "Repository ports for all data access."

import type { Review, ReviewPlatform } from '../../domain/types'
import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'

export type ReviewRepository = Readonly<{
  findById(id: ReviewId, organizationId: OrganizationId): Promise<Review | null>
  findByIds(
    ids: ReadonlyArray<ReviewId>,
    organizationId: OrganizationId,
  ): Promise<ReadonlyArray<Review>>
  findByExternalId(
    platform: ReviewPlatform,
    externalId: string,
    organizationId: OrganizationId,
  ): Promise<Review | null>
  upsert(review: Omit<Review, 'createdAt' | 'updatedAt'>, now?: Date): Promise<Review>
  findByPropertyId(
    propertyId: PropertyId,
    organizationId: OrganizationId,
    options?: { limit?: number },
  ): Promise<ReadonlyArray<Review>>
  /**
   * BQC-1.4: serving read for recent reviews — eligible content only
   * (contentExpiresAt IS NOT NULL AND > now, predicate in SQL), newest first.
   * Operations paths use findByPropertyId instead.
   */
  findRecentEligibleByPropertyId(
    propertyId: PropertyId,
    organizationId: OrganizationId,
    options: { limit: number },
    now: Date,
  ): Promise<ReadonlyArray<Review>>
  findByOrganizationId(orgId: OrganizationId): Promise<ReadonlyArray<Review>>
  /**
   * Review-owned eligible id query for cross-context list filters (BQC-1.2).
   * Returns ids of reviews whose content is eligible at `now`
   * (contentExpiresAt IS NOT NULL AND > now), optionally narrowed by rating
   * range and case-insensitive text search. Callers avoid cross-context JOINs.
   */
  findIdsByContentFilter(
    orgId: OrganizationId,
    filter: Readonly<{ ratingMin?: number; ratingMax?: number; textQuery?: string }>,
    now: Date,
  ): Promise<ReadonlyArray<string>>
  /**
   * ⚠️ CROSS-TENANT: System-level query — scans ALL orgs.
   * Reviews with non-null `contentExpiresAt <= date` (inclusive).
   * Used by refresh-expiring (pass refresh-due threshold).
   */
  findAllExpiringBeforeAcrossTenants(date: Date): Promise<ReadonlyArray<Review>>
  /**
   * ⚠️ CROSS-TENANT: BQC-1.5 keyset-bounded batch of expiring reviews,
   * ordered (contentExpiresAt ASC, id ASC). `cursor` resumes strictly AFTER
   * (contentExpiresAt, id) — no row is skipped or repeated as the cursor
   * advances. Replaces the one-shot 5,000-row scan.
   */
  findExpiringBatchAcrossTenants(
    date: Date,
    cursor: Readonly<{ contentExpiresAt: Date; id: string }> | null,
    limit: number,
  ): Promise<ReadonlyArray<Review>>
  /**
   * ⚠️ CROSS-TENANT: System-level query — scans ALL orgs.
   * Reviews with non-null `contentExpiresAt < date` (exclusive).
   * Used by purge-expired (pass `now`; no post-expiry grace — ADR 0031).
   */
  findAllExpiredBeforeAcrossTenants(date: Date): Promise<ReadonlyArray<Review>>
  deleteById(id: ReviewId, organizationId: OrganizationId): Promise<void>
  deleteByPropertyId(
    propertyId: PropertyId,
    organizationId: OrganizationId,
  ): Promise<void>
}>
