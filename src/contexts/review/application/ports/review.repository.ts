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
  findByOrganizationId(orgId: OrganizationId): Promise<ReadonlyArray<Review>>
  /**
   * ⚠️ CROSS-TENANT: System-level query — scans ALL orgs.
   * Reviews with non-null `contentExpiresAt <= date` (inclusive).
   * Used by refresh-expiring (pass refresh-due threshold).
   */
  findAllExpiringBeforeAcrossTenants(date: Date): Promise<ReadonlyArray<Review>>
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
