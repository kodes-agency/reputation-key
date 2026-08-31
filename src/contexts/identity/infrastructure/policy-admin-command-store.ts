// Identity-owned atomic persistence for policy administration.
//
// Every method commits the policy/grant mutation, its policy-version change,
// and the required content-free audit in one PostgreSQL transaction. Cache
// refresh and cross-context reconciliation deliberately remain post-commit
// application effects.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Tx } from '#/shared/outbox/commit'
import type {
  PolicyAdminAuditEntry,
  PolicyAdminCommandStore,
} from '../application/ports/policy-admin-command-store.port'
import {
  addOrganizationCapability,
  addPropertyCapability,
  removeOrganizationCapability,
  removePropertyCapability,
  setOrganizationPolicy,
  setPropertyPolicy,
} from './repositories/policy-state.repository'
import {
  grantPropertyAccess,
  revokePropertyAccess,
} from './repositories/property-access-grant.repository'
import { writePolicyDecision } from './repositories/policy-decision-audit.repository'

type AuditWriter = (tx: Tx, entry: PolicyAdminAuditEntry) => Promise<void>

export type PolicyAdminCommandStoreOptions = Readonly<{
  /** Transaction-bound fault seam used by atomicity verification. */
  writeAudit?: AuditWriter
}>

async function lockCommand(tx: Tx, key: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`)
}

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

async function organizationCapabilityIsEnabled(
  tx: Tx,
  organizationId: string,
  capability: string,
): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT 1 AS one
    FROM organization_capability
    WHERE organization_id = ${organizationId} AND capability = ${capability}
  `)
  return rows.rows.length > 0
}

async function propertyCapabilityIsEnabled(
  tx: Tx,
  propertyId: string,
  capability: string,
): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT 1 AS one
    FROM property_capability
    WHERE property_id = ${propertyId}::uuid AND capability = ${capability}
  `)
  return rows.rows.length > 0
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
  options: PolicyAdminCommandStoreOptions = {},
): PolicyAdminCommandStore => {
  const writeAudit: AuditWriter =
    options.writeAudit ?? ((tx, entry) => writePolicyDecision(tx, entry))
  const commitAudited = async (
    audit: PolicyAdminAuditEntry,
    mutate: (tx: Tx) => Promise<void>,
  ): Promise<void> => {
    await db.transaction(async (tx) => {
      await mutate(tx)
      await writeAudit(tx, audit)
    })
  }

  return {
    setOrganizationCapability: async (command) => {
      await commitAudited(command.audit, async (tx) => {
        await lockCommand(
          tx,
          `policy-admin:org-capability:${command.organizationId}:${command.capability}`,
        )
        const enabled = await organizationCapabilityIsEnabled(
          tx,
          command.organizationId,
          command.capability,
        )
        if (command.enabled && !enabled) {
          await addOrganizationCapability(
            tx,
            command.organizationId,
            command.capability,
            command.createdBy,
          )
        } else if (!command.enabled && enabled) {
          await removeOrganizationCapability(
            tx,
            command.organizationId,
            command.capability,
          )
        }
      })
    },

    setPropertyCapability: async (command) => {
      await commitAudited(command.audit, async (tx) => {
        await lockCommand(
          tx,
          `policy-admin:property-capability:${command.propertyId}:${command.capability}`,
        )
        await requirePropertyInOrganization(
          tx,
          command.organizationId,
          command.propertyId,
        )
        const enabled = await propertyCapabilityIsEnabled(
          tx,
          command.propertyId,
          command.capability,
        )
        if (command.enabled && !enabled) {
          await addPropertyCapability(
            tx,
            command.propertyId,
            command.capability,
            command.createdBy,
          )
        } else if (!command.enabled && enabled) {
          await removePropertyCapability(tx, command.propertyId, command.capability)
        }
      })
    },

    setOrganizationSuspension: async (command) => {
      await commitAudited(command.audit, async (tx) => {
        await lockCommand(tx, `policy-admin:org-suspension:${command.organizationId}`)
        await setOrganizationPolicy(tx, {
          organizationId: command.organizationId,
          suspendedAt: command.suspendedAt,
          suspendedReason: command.suspendedReason,
        })
      })
    },

    setPropertySuspension: async (command) => {
      await commitAudited(command.audit, async (tx) => {
        await lockCommand(tx, `policy-admin:property-suspension:${command.propertyId}`)
        await requirePropertyInOrganization(
          tx,
          command.organizationId,
          command.propertyId,
        )
        await setPropertyPolicy(tx, {
          propertyId: command.propertyId,
          suspendedAt: command.suspendedAt,
          suspendedReason: command.suspendedReason,
        })
      })
    },

    grantPropertyAccess: async (command) => {
      await commitAudited(command.audit, async (tx) => {
        await lockCommand(
          tx,
          `policy-admin:property-grant:${command.organizationId}:${command.propertyId}:${command.userId}`,
        )
        await requirePropertyInOrganization(
          tx,
          command.organizationId,
          command.propertyId,
        )
        await requireOrganizationMember(tx, command.organizationId, command.userId)
        if (!(await hasUnrevokedPropertyGrant(tx, command))) {
          await grantPropertyAccess(tx, {
            organizationId: command.organizationId,
            propertyId: command.propertyId,
            userId: command.userId,
            source: command.source,
            createdBy: command.createdBy,
            expiresAt: command.expiresAt,
          })
        }
      })
    },

    revokePropertyAccess: async (command) => {
      await commitAudited(command.audit, async (tx) => {
        await lockCommand(
          tx,
          `policy-admin:property-grant:${command.organizationId}:${command.propertyId}:${command.userId}`,
        )
        await requirePropertyInOrganization(
          tx,
          command.organizationId,
          command.propertyId,
        )
        await revokePropertyAccess(tx, {
          organizationId: command.organizationId,
          propertyId: command.propertyId,
          userId: command.userId,
          reason: command.reason,
        })
      })
    },
  }
}
