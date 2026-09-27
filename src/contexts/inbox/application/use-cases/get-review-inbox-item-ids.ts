// Inbox context — get review inbox item ids use case
// Resolves Reviews at one Property to the Inbox Items that open them, so a
// surface that cites a Review (Guest voice's supporting reviews) can link to it.
// A navigation read: a Review the caller could not open answers the same as a
// Review without an item — it is absent — and neither is an error.

import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxItemId, PropertyId, ReviewId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { inboxError } from '../../domain/errors'
import {
  isInboxSourcePropertyWithinScopes,
  resolveInboxSourceScopes,
} from '../inbox-access'

/** A navigation lookup names the Reviews one surface cites, never a scan. */
export const REVIEW_INBOX_ITEM_LOOKUP_LIMIT = 100

export type GetReviewInboxItemIdsInput = Readonly<{
  propertyId: PropertyId
  reviewIds: ReadonlyArray<ReviewId>
}>

export type GetReviewInboxItemIdsDeps = Readonly<{
  repo: InboxRepository
  staffPublicApi: StaffPublicApi
}>

export type GetReviewInboxItemIds = (
  input: GetReviewInboxItemIdsInput,
  ctx: AuthContext,
) => Promise<ReadonlyMap<ReviewId, InboxItemId>>

export const getReviewInboxItemIds =
  (deps: GetReviewInboxItemIdsDeps): GetReviewInboxItemIds =>
  async (input, ctx) => {
    if (input.reviewIds.length > REVIEW_INBOX_ITEM_LOOKUP_LIMIT) {
      throw inboxError(
        'invalid_input',
        `At most ${REVIEW_INBOX_ITEM_LOOKUP_LIMIT} Reviews can be resolved at once`,
        { reviewCount: input.reviewIds.length },
      )
    }
    if (input.reviewIds.length === 0) return new Map()

    // The same `inbox.read ∧ review.read` Property envelope that opening the
    // item enforces, so a link is offered only where it can open.
    const scopes = await resolveInboxSourceScopes(deps.staffPublicApi, ctx, 'read')
    if (!isInboxSourcePropertyWithinScopes(scopes, 'review', input.propertyId)) {
      return new Map()
    }
    return deps.repo.findActiveReviewItemIds(
      ctx.organizationId,
      input.propertyId,
      input.reviewIds,
    )
  }
