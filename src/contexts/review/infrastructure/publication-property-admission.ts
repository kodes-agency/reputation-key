// Whether a Property still admits an authorized publication cycle: the lock a
// publication claim takes on the Property, and the rule the provider
// authorizer applies to what it reads. The claim in reply-command-store.ts
// cancels the cycle instead of claiming it when this says no.

import { and, eq, isNull } from 'drizzle-orm'
import { properties } from '#/shared/db/schema/property.schema'
import type { Tx } from '#/shared/outbox/commit'
import type { Reply } from '../domain/types'

export type PublicationProperty = Readonly<{
  lifecycleState: string
  sourceEpoch: number
}>

/**
 * The Property this claim is admitted under, locked FOR SHARE ahead of Reply
 * truth (the canonical order in review-source-mutation-serialization.ts). An
 * Archive or Restore therefore commits wholly before this claim decides, or
 * after the claimed attempt is recorded; the provider authorizer's own
 * refusal covers the second case.
 */
export async function lockPublicationProperty(
  tx: Tx,
  organizationId: Reply['organizationId'],
  propertyId: string,
): Promise<PublicationProperty | null> {
  const rows = await tx
    .select({
      lifecycleState: properties.lifecycleState,
      sourceEpoch: properties.sourceEpoch,
    })
    .from(properties)
    .where(
      and(
        eq(properties.organizationId, organizationId),
        eq(properties.id, propertyId),
        isNull(properties.deletedAt),
      ),
    )
    .for('share')
    .limit(1)
  return rows[0] ?? null
}

/**
 * The provider authorizer admits a write only for an active Property at the
 * source epoch the cycle was authorized at. Anything else (an Archive, or a
 * Restore since approval) would be refused and reported as a Google rejection.
 */
export function propertyAdmitsCycle(
  property: PublicationProperty | null,
  authorization: Readonly<{ sourceEpoch: number }>,
): boolean {
  return (
    property !== null &&
    property.lifecycleState === 'active' &&
    property.sourceEpoch === authorization.sourceEpoch
  )
}
