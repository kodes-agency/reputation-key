import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { z } from 'zod/v4'
import type { Database } from '#/shared/db'
import { auditEvents } from '#/shared/db/schema/audit-events.schema'
import { auditEventCutoff } from './retention.server'

const query = z.strictObject({
  organizationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$/u),
  propertyId: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$/u)
    .optional(),
  observedAt: z.date(),
  limit: z.number().int().min(1).max(100).default(100),
})

/** Operator scope is supplied by the authorized command, never an untrusted filter. */
export async function queryAuditEvents(db: Database, input: z.input<typeof query>) {
  const scope = query.parse(input)
  return db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organizationId, scope.organizationId),
        scope.propertyId ? eq(auditEvents.propertyId, scope.propertyId) : undefined,
        gte(auditEvents.occurredAt, auditEventCutoff(scope.observedAt)),
        lte(auditEvents.occurredAt, scope.observedAt),
      ),
    )
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
    .limit(scope.limit)
}
