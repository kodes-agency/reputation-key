// Property context — BQC-4.4 loader for the operator region diagnostic.
//
// Org-scoped, content-free lookup of the property's persisted region facts
// (migration 0006: processing_region + processing_region_source +
// routing_policy_version). Distinct from the 4.2 createPropertyRoutingLoader
// (router port, id-only by contract): this loader scopes by organization so
// the 2.7 diagnostic surface treats cross-org properties as missing (least
// privilege) and carries the region SOURCE for operator display.

import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { properties } from '#/shared/db/schema/property.schema'
import type { PropertyRegionRecord } from '#/shared/auth/policy-diagnostic'

export function createPropertyRegionLoader(deps: {
  db: Database
}): (organizationId: string, propertyId: string) => Promise<PropertyRegionRecord | null> {
  return async (organizationId, propertyId) => {
    const rows = await deps.db
      .select({
        processingRegion: properties.processingRegion,
        processingRegionSource: properties.processingRegionSource,
        routingPolicyVersion: properties.routingPolicyVersion,
      })
      .from(properties)
      .where(
        and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)),
      )
      .limit(1)
    const row = rows[0]
    if (!row) return null
    return {
      processingRegion: row.processingRegion,
      processingRegionSource: row.processingRegionSource,
      routingPolicyVersion: row.routingPolicyVersion,
    }
  }
}
