// Identity-owned atomic persistence for PropertyAccessGrant administration.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Tx } from '#/shared/outbox/commit'
import type { PolicyAdminCommandStore } from '../application/ports/policy-admin-command-store.port'
import {
  grantPropertyAccess,
  revokePropertyAccess,
} from './repositories/property-access-grant.repository'

async function requirePropertyInOrganization(
  tx: Tx,
  organizationId: string,
  propertyId: string,
): Promise<void> {
  const rows = await tx.execute(sql`
    SELECT 1 AS one
    FROM properties
    WHERE organization_id = ${organizationId} AND id = ${propertyId}::uuid
    FOR KEY SHARE
  `)
  if (rows.rows.length === 0) throw new Error('property not found in organization')
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

async function hasUnrevokedPropertyGrant(
  tx: Tx,
  input: Readonly<{ organizationId: string; propertyId: string; userId: string }>,
): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT 1 AS one
    FROM property_access_grant
    WHERE organization_id = ${input.organizationId}
      AND property_id = ${input.propertyId}::uuid
      AND user_id = ${input.userId}
      AND revoked_at IS NULL
    FOR UPDATE
  `)
  return rows.rows.length > 0
}

export const createPostgresPolicyAdminCommandStore = (
  db: Database,
): PolicyAdminCommandStore => ({
  grantPropertyAccess: async (command) => {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`policy-admin:property-grant:${command.organizationId}:${command.propertyId}:${command.userId}`}, 0))`,
      )
      await requirePropertyInOrganization(tx, command.organizationId, command.propertyId)
      await requireOrganizationMember(tx, command.organizationId, command.userId)
      if (!(await hasUnrevokedPropertyGrant(tx, command))) {
        await grantPropertyAccess(tx, command)
      }
    })
  },

  revokePropertyAccess: async (command) => {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`policy-admin:property-grant:${command.organizationId}:${command.propertyId}:${command.userId}`}, 0))`,
      )
      await requirePropertyInOrganization(tx, command.organizationId, command.propertyId)
      await revokePropertyAccess(tx, command)
    })
  },
})
