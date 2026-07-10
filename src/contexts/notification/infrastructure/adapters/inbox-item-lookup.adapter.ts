// Database adapter for the InboxItemLookupPort (ADR 0022).
// Resolves a review to its inbox item via the inbox_items unique index on
// (source_type, source_id, organization_id) — at most one row.
import type { Database } from '#/shared/db'
import { and, eq } from 'drizzle-orm'
import { inboxItems } from '#/shared/db/schema/inbox.schema'
import {
  inboxItemId,
  unbrand,
  type ReviewId,
  type OrganizationId,
  type InboxItemId,
} from '#/shared/domain/ids'

export const createInboxItemLookupAdapter = (db: Database) => ({
  async findInboxItemByReviewId(
    reviewId: ReviewId,
    orgId: OrganizationId,
  ): Promise<InboxItemId | null> {
    const rows = await db
      .select({ id: inboxItems.id })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.organizationId, unbrand(orgId)),
          eq(inboxItems.sourceType, 'review'),
          eq(inboxItems.sourceId, unbrand(reviewId)),
        ),
      )
      .limit(1)
    return rows[0] ? inboxItemId(rows[0].id) : null
  },
})
