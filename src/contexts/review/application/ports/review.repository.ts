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
  ): Promise<ReadonlyArray<Review>>
  findByOrganizationId(orgId: OrganizationId): Promise<ReadonlyArray<Review>>
  findAllExpiringBefore(date: Date): Promise<ReadonlyArray<Review>>
  findAllExpiredBefore(date: Date): Promise<ReadonlyArray<Review>>
  deleteById(id: ReviewId, organizationId: OrganizationId): Promise<void>
  deleteByPropertyId(
    propertyId: PropertyId,
    organizationId: OrganizationId,
  ): Promise<void>
}>
