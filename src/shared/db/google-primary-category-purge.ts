import { sql, type SQL } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'

async function clearGooglePrimaryCategory(tx: Tx, scope: SQL): Promise<void> {
  await tx.execute(sql`
    UPDATE properties
    SET google_primary_category = NULL,
        google_primary_category_updated_at = NULL,
        google_primary_category_refresh_event_id = NULL
    WHERE ${scope}
  `)
}

/** Runs inside the disconnect or AI erasure transaction that owns the action. */
export function clearGooglePrimaryCategoryForProperty(
  tx: Tx,
  scope: Readonly<{ organizationId: string; propertyId: string }>,
): Promise<void> {
  return clearGooglePrimaryCategory(
    tx,
    sql`
    organization_id = ${scope.organizationId} AND id = ${scope.propertyId}::uuid
  `,
  )
}

export function clearGooglePrimaryCategoryForConnection(
  tx: Tx,
  scope: Readonly<{ organizationId: string; connectionId: string }>,
): Promise<void> {
  return clearGooglePrimaryCategory(
    tx,
    sql`
    organization_id = ${scope.organizationId}
    AND google_connection_id = ${scope.connectionId}::uuid
  `,
  )
}

export function clearGooglePrimaryCategoryForOrganization(
  tx: Tx,
  organizationId: string,
): Promise<void> {
  return clearGooglePrimaryCategory(tx, sql`organization_id = ${organizationId}`)
}
