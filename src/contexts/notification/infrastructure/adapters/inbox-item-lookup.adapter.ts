// Database adapter for the InboxItemLookupPort (ADR 0022).
// Resolves a review to its inbox item via the inbox_items unique index on
// (source_type, source_id, organization_id) — at most one row — and reads the
// content-free render facts (ADR 0046 r.8) the events do not carry. The
// property join mirrors notification-property-scope.repository.ts, which
// already reads `properties` from this context.
import type { Database } from '#/shared/db'
import { and, eq } from 'drizzle-orm'
import { inboxItems } from '#/shared/db/schema/inbox.schema'
import { properties } from '#/shared/db/schema/property.schema'
import {
  inboxItemId,
  unbrand,
  type ReviewId,
  type OrganizationId,
  type InboxItemId,
} from '#/shared/domain/ids'
import type { InboxItemFacts } from '../../application/ports/inbox-item-lookup.port'

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

  async findInboxItemFacts(
    id: InboxItemId,
    orgId: OrganizationId,
  ): Promise<InboxItemFacts | null> {
    // Two reads, not a join: `inbox_items.property_id` is varchar while
    // `properties.id` is uuid, so PostgreSQL has no operator for the
    // column-to-column comparison. As a bound parameter the id casts cleanly.
    const rows = await db
      .select({
        propertyId: inboxItems.propertyId,
        rating: inboxItems.rating,
        sourceType: inboxItems.sourceType,
        createdAt: inboxItems.createdAt,
      })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.organizationId, unbrand(orgId)),
          eq(inboxItems.id, unbrand(id)),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (!row) return null

    // A missing/deleted property must still yield the rating and the age: copy
    // degrades to "New 2-star review", never to nothing.
    const propertyRows = await db
      .select({ name: properties.name })
      .from(properties)
      .where(
        and(
          eq(properties.organizationId, unbrand(orgId)),
          eq(properties.id, row.propertyId),
        ),
      )
      .limit(1)

    return {
      propertyId: row.propertyId,
      propertyName: propertyRows[0]?.name ?? null,
      rating: row.rating ?? null,
      sourceType: row.sourceType,
      createdAt: row.createdAt,
    }
  },
})
