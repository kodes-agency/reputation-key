// Members access edits — one PostgreSQL transaction grants and revokes a
// PropertyManager's Properties and records identity.member.property_access_changed.
//
// It takes the operator surface's per-grant advisory locks (sorted, so two
// edits cannot deadlock) and reuses its grant/revoke statements, so an
// operator grant and an access edit on the same Property serialize and
// converge on one active grant. The membership row is locked so a concurrent
// role change or removal decides first or waits.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import { identityError } from '../domain/errors'
import type {
  AppliedPropertyAccess,
  MemberPropertyAccess,
  MemberPropertyAccessStore,
  SetPropertyAccessCommand,
} from '../application/ports/member-property-access.port'
import {
  grantPropertyAccess,
  revokePropertyAccess,
} from './repositories/property-access-grant.repository'
import {
  lockPropertyGrant,
  lockPropertyInOrganization,
  lockUnrevokedGrant,
} from './property-grant-locks'

/** The Better Auth role token of a PropertyManager. */
const PROPERTY_MANAGER_ROLE_TOKEN = 'admin'

/** Why a grant this edit replaced was retired. */
const SUPERSEDED_REASON = 'superseded'
/** Why an edit revoked a grant. */
const MEMBER_ACCESS_EDIT_REASON = 'member_access_edit'

/** Lock the membership and require a PropertyManager, exactly. */
async function lockPropertyManagerMembership(
  tx: Tx,
  organizationId: string,
  userId: string,
): Promise<void> {
  const rows = await tx.execute(sql`
    SELECT role
    FROM member
    WHERE "organizationId" = ${organizationId} AND "userId" = ${userId}
    FOR UPDATE
  `)
  const role = (rows.rows[0] as { role: string } | undefined)?.role
  if (role !== PROPERTY_MANAGER_ROLE_TOKEN) {
    throw identityError(
      'forbidden',
      'Property access can be changed only for a Property Manager of this organization',
    )
  }
}

/** Grant one Property unless an active grant already covers it. */
async function grantOne(
  tx: Tx,
  command: SetPropertyAccessCommand,
  propertyId: string,
): Promise<boolean> {
  const key = {
    organizationId: command.organizationId,
    propertyId,
    userId: command.userId,
  }
  const live = await lockPropertyInOrganization(tx, { ...key, live: true })
  if (!live) {
    throw identityError(
      'validation_error',
      'A selected property is not in this organization',
    )
  }
  const current = await lockUnrevokedGrant(tx, key)
  if (current && (current.expiresAt === null || current.expiresAt > command.now)) {
    return false
  }
  // A lapsed grant still holds the one-active-grant slot: retire it first.
  if (current) await revokePropertyAccess(tx, { ...key, reason: SUPERSEDED_REASON })
  await grantPropertyAccess(tx, {
    ...key,
    source: 'operator',
    createdBy: command.actorUserId,
  })
  return true
}

async function applyPropertyAccess(
  tx: Tx,
  command: SetPropertyAccessCommand,
): Promise<AppliedPropertyAccess> {
  const grantIds = [...new Set(command.grantPropertyIds)].sort()
  const revokeIds = [...new Set(command.revokePropertyIds)].sort()
  for (const propertyId of [...new Set([...grantIds, ...revokeIds])].sort()) {
    await lockPropertyGrant(tx, {
      organizationId: command.organizationId,
      propertyId,
      userId: command.userId,
    })
  }
  await lockPropertyManagerMembership(tx, command.organizationId, command.userId)

  const grantedPropertyIds: string[] = []
  for (const propertyId of grantIds) {
    if (await grantOne(tx, command, propertyId)) grantedPropertyIds.push(propertyId)
  }
  const revokedPropertyIds: string[] = []
  for (const propertyId of revokeIds) {
    const revoked = await revokePropertyAccess(tx, {
      organizationId: command.organizationId,
      propertyId,
      userId: command.userId,
      reason: MEMBER_ACCESS_EDIT_REASON,
    })
    if (revoked) revokedPropertyIds.push(propertyId)
  }

  const applied = { grantedPropertyIds, revokedPropertyIds }
  if (grantedPropertyIds.length + revokedPropertyIds.length > 0) {
    await insertOutboxRow(tx, command.buildEvent(applied))
  }
  return applied
}

function groupByMember(
  rows: ReadonlyArray<Readonly<{ user_id: string; property_id: string }>>,
): ReadonlyArray<MemberPropertyAccess> {
  const byMember = new Map<string, string[]>()
  for (const row of rows) {
    const propertyIds = byMember.get(row.user_id) ?? []
    propertyIds.push(row.property_id)
    byMember.set(row.user_id, propertyIds)
  }
  return [...byMember].map(([userId, propertyIds]) => ({ userId, propertyIds }))
}

export const createMemberPropertyAccessStore = (
  db: Database,
): MemberPropertyAccessStore => ({
  listActiveByOrganization: async (organizationId, at) => {
    const rows = await db.execute(sql`
      SELECT grants.user_id, grants.property_id::text AS property_id
      FROM property_access_grant grants
      JOIN properties
        ON properties.organization_id = grants.organization_id
       AND properties.id = grants.property_id
       AND properties.deleted_at IS NULL
      WHERE grants.organization_id = ${organizationId}
        AND grants.revoked_at IS NULL
        AND (grants.expires_at IS NULL OR grants.expires_at > ${at})
      ORDER BY grants.user_id, grants.property_id
    `)
    return groupByMember(rows.rows as Array<{ user_id: string; property_id: string }>)
  },

  setPropertyAccess: (command) =>
    trace('identity.memberPropertyAccess.set', () =>
      db.transaction((tx) => applyPropertyAccess(tx, command)),
    ),
})
