import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { inboxItems } from '#/shared/db/schema/inbox.schema'
import { properties } from '#/shared/db/schema/property.schema'
import { propertyId, unbrand, userId } from '#/shared/domain/ids'
import type { EscalationResolutionLookupPort } from '../../application/ports/escalation-resolution-lookup.port'

/** Notification-owned, content-free adapter over the current Inbox authority. */
export const createEscalationResolutionLookupAdapter = (
  db: Database,
): EscalationResolutionLookupPort => {
  return {
    async findEscalationResolutionFacts(inboxItemId, organizationId) {
      const [row] = await db
        .select({
          propertyId: inboxItems.propertyId,
          assignedTo: inboxItems.assignedTo,
          isEscalated: inboxItems.isEscalated,
          resolvedAt: inboxItems.escalationResolvedAt,
          resolvedBy: inboxItems.escalationResolvedBy,
        })
        .from(inboxItems)
        .where(
          and(
            eq(inboxItems.id, unbrand(inboxItemId)),
            eq(inboxItems.organizationId, unbrand(organizationId)),
          ),
        )
        .limit(1)
      if (!row) return null

      const [property] = await db
        .select({ name: properties.name })
        .from(properties)
        .where(
          and(
            eq(properties.organizationId, unbrand(organizationId)),
            eq(properties.id, row.propertyId),
          ),
        )
        .limit(1)

      return {
        propertyId: propertyId(row.propertyId),
        assignedTo: row.assignedTo ? userId(row.assignedTo) : null,
        propertyName: property?.name ?? null,
        isEscalated: row.isEscalated,
        resolvedAt: row.resolvedAt,
        resolvedBy: row.resolvedBy ? userId(row.resolvedBy) : null,
      }
    },
  }
}
