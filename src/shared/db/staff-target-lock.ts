import { sql } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'

/** Serializes Goal definition and personal Group membership decisions. */
export async function lockStaffTargetProperty(
  tx: Tx,
  organizationId: string,
  propertyId: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`staff-target:${organizationId}:${propertyId}`}, 0))`,
  )
}
