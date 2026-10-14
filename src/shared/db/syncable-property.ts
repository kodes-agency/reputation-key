// Which Properties Google review sync polls. One definition, two readers:
// Review's discovery sweep selects on it, and the sync health gauges count only
// rows it admits. A gauge that counted a Property the sweep no longer selects
// would hold its alert on for good, because nothing rewrites that Property's
// poll time again.

import { and, eq, isNull } from 'drizzle-orm'
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
