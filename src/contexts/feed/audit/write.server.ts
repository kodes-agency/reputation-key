import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { Database, Tx } from '#/shared/db'
import { auditEvents } from '#/shared/db/schema/audit-events.schema'
import { parseAuditEvent } from './event.server'

/** Stable provenance fences replay and copying independently of generated row ids. */
export async function writeAuditEvent(db: Database | Tx, input: unknown) {
  const event = parseAuditEvent(input)
  const [inserted] = await db
    .insert(auditEvents)
    .values({ ...event, id: randomUUID() })
    .onConflictDoNothing({
      target: [auditEvents.organizationId, auditEvents.sourceKind, auditEvents.sourceId],
    })
    .returning({ id: auditEvents.id })
  if (inserted) return { status: 'appended' as const, id: inserted.id }

  const [existing] = await db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organizationId, event.organizationId),
        eq(auditEvents.sourceKind, event.sourceKind),
        eq(auditEvents.sourceId, event.sourceId),
      ),
    )
    .limit(1)
  // A reused source identity must never silently discard a different action.
  if (
    !existing ||
    Object.entries(event).some(([key, value]) => {
      const stored = existing[key as keyof typeof event]
      return value instanceof Date
        ? !(stored instanceof Date) || value.getTime() !== stored.getTime()
        : value !== stored
    })
  ) {
    throw new Error('Audit source identity conflict')
  }
  return { status: 'duplicate' as const, id: existing.id }
}
