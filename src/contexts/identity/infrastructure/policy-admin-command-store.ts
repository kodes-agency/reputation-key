// Identity-owned atomic persistence for PropertyAccessGrant administration.
//
// The operator grant and revoke take the Members access edit's per-grant lock
// and its grant write, so the two surfaces decide a lapsed grant the same way,
// and each change commits with its identity.member.property_access_changed
// fact. A command that changes nothing records none. A refusal is the tagged
// IdentityError the Members access edit gives for the same cause.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import type { PolicyAdminCommandStore } from '../application/ports/policy-admin-command-store.port'
import { identityError } from '../domain/errors'
import { revokePropertyAccess } from './repositories/property-access-grant.repository'
import { lockPropertyGrant, lockPropertyInOrganization } from './property-grant-locks'
import { writePropertyGrant } from './property-grant-write'

async function requirePropertyInOrganization(
  tx: Tx,
  input: Readonly<{ organizationId: string; propertyId: string; live: boolean }>,
): Promise<void> {
  if (!(await lockPropertyInOrganization(tx, input))) {
    throw identityError('validation_error', 'The property is not in this organization')
  }
}

async function requireOrganizationMember(
  tx: Tx,
  organizationId: string,
  userId: string,
): Promise<void> {
  const rows = await tx.execute(sql`
    SELECT 1 AS one
    FROM member
    WHERE "organizationId" = ${organizationId} AND "userId" = ${userId}
    FOR KEY SHARE
  `)
  if (rows.rows.length === 0) {
    throw identityError(
      'member_not_found',
      'The user is not a member of this organization',
    )
  }
}

export const createPostgresPolicyAdminCommandStore = (
  db: Database,
): PolicyAdminCommandStore => ({
  grantPropertyAccess: async (command) => {
    await db.transaction(async (tx) => {
      await lockPropertyGrant(tx, command)
      // Nothing new is granted on a deleted Property.
      await requirePropertyInOrganization(tx, { ...command, live: true })
      await requireOrganizationMember(tx, command.organizationId, command.userId)
      // The operator names the expiry, so asking for another one replaces an
      // active grant; the same grant asked again is kept.
      const granted = await writePropertyGrant(tx, {
        organizationId: command.organizationId,
        propertyId: command.propertyId,
        userId: command.userId,
        createdBy: command.createdBy,
        expiresAt: command.expiresAt ?? null,
        replacesActiveTerm: true,
        now: command.now,
      })
      if (granted) await insertOutboxRow(tx, command.buildEvent())
    })
  },

  revokePropertyAccess: async (command) => {
    await db.transaction(async (tx) => {
      await lockPropertyGrant(tx, command)
      await requirePropertyInOrganization(tx, { ...command, live: false })
      const revoked = await revokePropertyAccess(tx, command)
      if (revoked) await insertOutboxRow(tx, command.buildEvent())
    })
  },
})
