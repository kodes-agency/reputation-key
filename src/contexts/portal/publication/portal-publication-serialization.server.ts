import { sql } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'

/**
 * Property-wide transaction fence shared by publication and every
 * Property-owned source that a Publication Snapshot resolves.
 */
export async function lockPortalPublicationProperty(
  tx: Tx,
  organizationId: string,
  propertyId: string,
): Promise<void> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`portal-publication:${organizationId}:${propertyId}`}, 0)
    )
  `)
}

/** Exact aggregate fence for Portal-owned localized working-copy changes. */
export async function lockPortalPublicationWorkingCopy(
  tx: Tx,
  organizationId: string,
  propertyId: string,
  portalId: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    SELECT id
    FROM portals
    WHERE organization_id = ${organizationId}
      AND property_id = ${propertyId}
      AND id = ${portalId}
      AND deleted_at IS NULL
    FOR UPDATE
  `)
  return result.rows.length === 1
}
