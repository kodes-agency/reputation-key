// Review context — get staff recent activity use case
// Extracted from the server fn (D8-003): authorization scoping + read now
// live in a single review-side use case. The server fn just resolves
// tenant context, checks the review.read permission, and delegates here.

import type { ReviewRepository } from '../ports/review.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'
import type { PropertyId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffRecentReview } from '../public-api'

export type GetStaffRecentActivityDeps = Readonly<{
  reviewRepo: ReviewRepository
  staffPublicApi: StaffPublicApi
}>

export type GetStaffRecentActivityInput = Readonly<{
  propertyId: PropertyId
  limit?: number
}>

export const getStaffRecentActivity =
  (deps: GetStaffRecentActivityDeps) =>
  async (
    input: GetStaffRecentActivityInput,
    ctx: AuthContext,
  ): Promise<StaffRecentReview[]> => {
    // Authorization gate: verify the caller has access to this property.
    // Scope resolved per-permission (review.read): org-wide (AccountAdmin) →
    // all accessible; assigned scope (PM/Staff) → assigned set.
    const accessible = await isPropertyAccessibleForPermission(
      deps.staffPublicApi.getAccessiblePropertyIds,
      ctx,
      'review.read',
      input.propertyId,
    )
    if (!accessible) return []

    const limit = input.limit ?? 5
    const recentReviews = await deps.reviewRepo.findByPropertyId(
      input.propertyId,
      ctx.organizationId,
      { limit },
    )
    return recentReviews.map((r) => ({
      id: r.id as string,
      rating: r.rating,
      snippet: r.text ?? '',
      date: r.reviewedAt.toISOString(),
    }))
  }
