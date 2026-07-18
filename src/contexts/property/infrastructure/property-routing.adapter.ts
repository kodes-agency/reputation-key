// Property context — BQC-4.2 production adapter for the ProcessingRouter's
// loadPropertyRouting port.
//
// Identifier-only lookup of the property's persisted routing facts
// (migration 0006: processing_region + routing_policy_version). No content
// crosses the router — region and policy version are content-free routing
// facts (ADR 0048 "control-plane metadata"). The router module itself stays
// drizzle-free in the shared zone; the worker/composition wire this adapter
// with container.db (same shape as publish-reply-scope-resolver, BQC-3.2).
//
// Lookup is by id only: a missing row yields null → the router blocks with
// property_missing (fail closed). Soft-deleted rows keep their routing facts;
// lifecycle/suspension enforcement stays with the 3.2 policy gate, not here.

import { eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { properties } from '#/shared/db/schema/property.schema'
import type { PropertyRoutingRecord } from '#/shared/routing/processing-router'

export function createPropertyRoutingLoader(deps: {
  db: Database
}): (propertyId: string) => Promise<PropertyRoutingRecord | null> {
  return async (propertyId) => {
    const rows = await deps.db
      .select({
        processingRegion: properties.processingRegion,
        routingPolicyVersion: properties.routingPolicyVersion,
      })
      .from(properties)
      .where(eq(properties.id, propertyId))
      .limit(1)
    const row = rows[0]
    if (!row) return null
    return {
      processingRegion: row.processingRegion,
      routingPolicyVersion: row.routingPolicyVersion,
    }
  }
}
