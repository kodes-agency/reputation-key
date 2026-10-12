// Identity-owned atomic persistence for PropertyAccessGrant administration.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Tx } from '#/shared/outbox/commit'
import type { PolicyAdminCommandStore } from '../application/ports/policy-admin-command-store.port'
import {
  grantPropertyAccess,
  revokePropertyAccess,
} from './repositories/property-access-grant.repository'
import {
  lockPropertyGrant,
  lockPropertyInOrganization,
  lockUnrevokedGrant,
} from './property-grant-locks'

async function requirePropertyInOrganization(
  tx: Tx,
  input: Readonly<{ organizationId: string; propertyId: string; live: boolean }>,
): Promise<void> {
  if (!(await lockPropertyInOrganization(tx, input))) {
    throw new Error('property not found in organization')
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
    throw new Error(`user ${userId} is not a member of this organization`)
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
      if ((await lockUnrevokedGrant(tx, command)) === null) {
        await grantPropertyAccess(tx, command)
      }
    })
  },

  revokePropertyAccess: async (command) => {
    await db.transaction(async (tx) => {
      await lockPropertyGrant(tx, command)
      await requirePropertyInOrganization(tx, { ...command, live: false })
      await revokePropertyAccess(tx, command)
    })
  },
})
