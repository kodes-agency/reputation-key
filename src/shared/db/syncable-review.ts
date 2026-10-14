// Whether a stored Review can still be refreshed by a sync.
//
// A refresh sync is authorized against the Property's CURRENT Google binding
// (`google-review-sync-authorizer.ts`): the Property must be live, bound to
// Google and bound to the connection the job names, and that connection must
// be usable. The Review row keeps the connection and location it was fetched
// through after an archive, a suspension or a disconnect, so its content clock
// alone cannot say whether a sync for it can succeed. The discovery sweep asks
// the same question of the Property (`propertyIsSyncable`); this asks it of a
// Review's own connection. Two readers: Review's refresh sweep offers only
// Reviews that satisfy it, and the review-content health gauge counts as
// refresh-due only the Reviews the sweep can offer, so the freshness alert
// does not page for content nobody is going to refresh.

import { and, eq, exists, sql } from 'drizzle-orm'
import { QueryBuilder } from 'drizzle-orm/pg-core'
import { googleConnections } from './schema/google-connection.schema'
import { properties } from './schema/property.schema'
import { reviews } from './schema/review.schema'
import { propertyIsSyncable } from './syncable-property'

/**
 * A condition over `reviews`: its Property is syncable through the Review's
 * connection. The subquery is built without a database handle, so a reader can
 * embed it in a query it runs on any handle (or a test fake). It ties the
 * Property to the outer Review on Organization, Property and Google connection,
 * so it never admits another tenant's Property; the cross-tenant sweeps that
 * embed it return every Review with its tenant identity.
 */
export function reviewIsSyncable() {
  return exists(
    new QueryBuilder()
      .select({ one: sql`1` })
      .from(properties)
      .innerJoin(
        googleConnections,
        eq(googleConnections.id, properties.googleConnectionId),
      )
      .where(
        and(
          eq(properties.id, reviews.propertyId),
          eq(properties.organizationId, reviews.organizationId),
          eq(properties.googleConnectionId, reviews.googleConnectionId),
          propertyIsSyncable,
        ),
      ),
  )
}
