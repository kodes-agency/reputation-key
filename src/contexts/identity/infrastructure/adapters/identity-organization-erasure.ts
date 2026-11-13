// Identity's Organization erasure: the per-person and per-Property rows Identity
// keeps for one Organization. The rights executor runs it behind its journal
// entry; the replayer repeats it after a restore.
//
// The Organization's memberships and invitations go (an invitation carries the
// invitee's email, the inviter and Property ids). The login identities
// (`user`, `session`, `account`) stay: a person may belong to another
// Organization, and the participant scope erases a person. Merchant
// AI consent evidence and the enablement head stay too (the coverage gate lists
// why).
//
// A trigger refuses to delete an Organization's last owner, which every live
// Organization has. A closure removes every member, so that trigger is off
// only inside the closure's transaction, under a five-second lock timeout, and
// is on again before the commit. The lock it takes keeps every other write to
// `member` waiting meanwhile, and a failure rolls the change back with the
// deletes.

import { sql } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'

/** Better Auth's tables name their Organization column in camel case. */
const TENANT_COLUMN: Readonly<Record<string, string>> = {
  member: 'organizationId',
  invitation: 'organizationId',
}

const LOCK_TIMEOUT = '5s'
const LAST_OWNER_GUARD = Object.freeze({
  table: 'member',
  trigger: 'member_last_owner_del',
} as const)

/** No table here references another, so the order is only for reading. */
export const IDENTITY_ORGANIZATION_TABLES: readonly string[] = Object.freeze([
  'merchant_ai_decision_deferrals',
  'property_access_grant',
  'merchant_ai_notice_update_receipts',
  'product_update_receipts',
  'product_update_settings',
  'invitation',
  'member',
])

function inOrganization(table: string, organizationId: string) {
  return sql`${sql.identifier(TENANT_COLUMN[table] ?? 'organization_id')} = ${organizationId}`
}

export async function countIdentityOrganizationRows(
  tx: Tx,
  organizationId: string,
): Promise<ReadonlyArray<Readonly<{ table: string; rows: number }>>> {
  const counts: Array<Readonly<{ table: string; rows: number }>> = []
  for (const table of IDENTITY_ORGANIZATION_TABLES) {
    const result = await tx.execute(sql`
      SELECT count(*)::int AS count FROM ${sql.identifier(table)}
      WHERE ${inOrganization(table, organizationId)}
    `)
    counts.push({ table, rows: Number((result.rows[0] as { count: number }).count) })
  }
  return counts
}

/**
 * Deletes the Organization's Identity rows inside the caller's transaction;
 * returns the rows removed.
 */
export async function deleteIdentityOrganizationRows(
  tx: Tx,
  organizationId: string,
): Promise<number> {
  await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`))
  await tx.execute(
    sql`ALTER TABLE ${sql.identifier(LAST_OWNER_GUARD.table)}
        DISABLE TRIGGER ${sql.identifier(LAST_OWNER_GUARD.trigger)}`,
  )
  // No try/finally: a failed statement aborts the transaction, and the
  // rollback restores the guard.
  let deleted = 0
  for (const table of IDENTITY_ORGANIZATION_TABLES) {
    const result = await tx.execute(sql`
      DELETE FROM ${sql.identifier(table)}
      WHERE ${inOrganization(table, organizationId)}
      RETURNING 1
    `)
    deleted += result.rows.length
  }
  await tx.execute(
    sql`ALTER TABLE ${sql.identifier(LAST_OWNER_GUARD.table)}
        ENABLE TRIGGER ${sql.identifier(LAST_OWNER_GUARD.trigger)}`,
  )
  return deleted
}
