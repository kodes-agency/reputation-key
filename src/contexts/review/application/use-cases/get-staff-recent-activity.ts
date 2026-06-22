// Review context — get staff recent activity use case
// Extracted from the server fn (D8-003): authorization scoping + read now
// live in a single review-side use case. The server fn just resolves
// tenant context, checks the review.read permission, and delegates here.

import type { ReviewRepository } from '../ports/review.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { isPropertyAccessible } from '#/shared/domain/property-access'
import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import type { StaffRecentReview } from '../public-api'

export type GetStaffRecentActivityDeps = Readonly<{
  reviewRepo: ReviewRepository
  staffPublicApi: StaffPublicApi
}>

export type GetStaffRecentActivityInput = Readonly<{
  organizationId: OrganizationId
  userId: UserId
  role: Role
  propertyId: PropertyId
  limit?: number
}>

export const getStaffRecentActivity =
  (deps: GetStaffRecentActivityDeps) =>
  async (input: GetStaffRecentActivityInput): Promise<StaffRecentReview[]> => {
    // Authorization gate: verify the caller has access to this property.
    // AccountAdmin → org-wide (lookup returns null); PM/Staff → assigned set.
    const accessible = await isPropertyAccessible(
      deps.staffPublicApi.getAccessiblePropertyIds,
      input.organizationId,
      input.userId,
      input.role,
      input.propertyId,
    )
    if (!accessible) return []

    const limit = input.limit ?? 5
    const recentReviews = await deps.reviewRepo.findByPropertyId(
      input.propertyId,
      input.organizationId,
      { limit },
    )
    return recentReviews.map((r) => ({
      id: r.id as string,
      rating: r.rating,
      snippet: r.text ?? '',
      date: r.reviewedAt.toISOString(),
    }))
  }
