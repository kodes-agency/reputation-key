// Which Properties Google review sync polls. One definition, three readers:
// Review's discovery sweep and `reviewIsSyncable` (the refresh sweep, and the
// review-content health gauge) select on it, and the sync health gauges count
// only rows it admits. A gauge that
// counted a Property the sweep no longer selects would hold its alert on for
// good, because nothing rewrites that Property's poll time again. (Discovery
// adds its own conditions on top: a due poll time and no import in flight.)

import { and, eq, isNull, sql } from 'drizzle-orm'
import { googleConnections } from './schema/google-connection.schema'
import { properties } from './schema/property.schema'

/**
 * The Property is live (not soft-deleted, lifecycle `active`), bound to Google
 * (`google_binding_state = 'active'`, which the binding-tuple CHECK ties to a
 * connection, account and location) and its connection is active with usable
 * credential material. Written over `properties` joined to `google_connections`
 * on `properties.google_connection_id`.
 */
export const propertyIsSyncable = and(
  isNull(properties.deletedAt),
  eq(properties.lifecycleState, 'active'),
  eq(properties.googleBindingState, 'active'),
  eq(googleConnections.status, 'active'),
  eq(googleConnections.credentialUseState, 'active'),
)

/**
 * The last moment the Property may have started to qualify: the later of its
 * last administrative change (restore, resume, re-bind, rename) and the time
 * its Google connection was last authorised (a reconnect). A Property that
 * left the set keeps the poll time it had, so a gauge that measured lag from
 * `next_incremental_at` alone would call a restored Property days overdue
 * before the sweep has had a turn. `GREATEST` skips a NULL authorisation time.
 * Token refreshes (`google_connections.updated_at`) are deliberately not part
 * of it: an in-use connection refreshes about hourly and would hide a stalled
 * sweep. Written over the same join as `propertyIsSyncable`.
 */
export const propertySyncableSince = sql`GREATEST(${properties.updatedAt}, ${googleConnections.credentialAuthorizedAt})`
