// Row and advisory locks shared by every PropertyAccessGrant command: the
// operator grant/revoke surface and the Members access edit. Both take the
// same per-(Organization, Property, user) key, so they serialize with each
// other and converge on one active grant.

import { sql } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'

type GrantKey = Readonly<{ organizationId: string; propertyId: string; userId: string }>

/** Serialize every grant command for one (Organization, Property, user). */
export async function lockPropertyGrant(tx: Tx, key: GrantKey): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`policy-admin:property-grant:${key.organizationId}:${key.propertyId}:${key.userId}`}, 0))`,
  )
}

/**
 * Key-share lock the Property when it belongs to the Organization. With
 * `live`, a deleted Property counts as absent: nothing new may be granted on
 * it, while revoking what it still holds stays possible.
 */
export async function lockPropertyInOrganization(
  tx: Tx,
  input: Readonly<{ organizationId: string; propertyId: string; live: boolean }>,
): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT 1 AS one
    FROM properties
    WHERE organization_id = ${input.organizationId}
      AND id = ${input.propertyId}::uuid
      ${input.live ? sql`AND deleted_at IS NULL` : sql``}
    FOR KEY SHARE
  `)
  return rows.rows.length > 0
}

/**
 * Lock the unrevoked grant row, if any, and say when it lapses. An expired
 * grant is still unrevoked: the one-active-grant index counts it until a
 * revoke retires it.
 */
export async function lockUnrevokedGrant(
  tx: Tx,
  key: GrantKey,
): Promise<Readonly<{ expiresAt: Date | null }> | null> {
  const rows = await tx.execute(sql`
    SELECT expires_at
    FROM property_access_grant
    WHERE organization_id = ${key.organizationId}
      AND property_id = ${key.propertyId}::uuid
      AND user_id = ${key.userId}
      AND revoked_at IS NULL
    FOR UPDATE
  `)
  const row = rows.rows[0] as { expires_at: Date | string | null } | undefined
  if (!row) return null
  return { expiresAt: row.expires_at === null ? null : new Date(row.expires_at) }
}
