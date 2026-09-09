import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PropertyId, ReviewId } from '#/shared/domain/ids'
import { canForContext } from '#/shared/domain/permissions'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'
import type { Review } from '../../domain/types'
import { reviewError } from '../../domain/errors'
import type { ReviewRepository } from '../ports/review.repository'

export type ReplyAccessDeps = Readonly<{
  reviewRepo: ReviewRepository
  staffPublicApi: StaffPublicApi
}>

export function requireReplyManager(ctx: AuthContext): void {
  if (!canForContext(ctx, 'reply.manage')) {
    throw reviewError('unauthorized', 'Only managers and admins can manage replies')
  }
}

async function assertReplyPropertyAccessible(
  deps: ReplyAccessDeps,
  ctx: AuthContext,
  propertyId: PropertyId,
): Promise<void> {
  const accessible = await isPropertyAccessibleForPermission(
    (orgId, userId, orgWide) =>
      deps.staffPublicApi.getAccessiblePropertyIds(orgId, userId, orgWide),
    ctx,
    'reply.manage',
    propertyId,
  )
  if (!accessible) {
    throw reviewError('forbidden', 'No access to this property', { propertyId })
  }
}

export async function requireAccessibleReview(
  deps: ReplyAccessDeps,
  ctx: AuthContext,
  reviewId: ReviewId,
): Promise<Review> {
  const review = await deps.reviewRepo.findById(reviewId, ctx.organizationId)
  if (!review) throw reviewError('review_not_found', 'Review not found')
  await assertReplyPropertyAccessible(deps, ctx, review.propertyId)
  return review
}
