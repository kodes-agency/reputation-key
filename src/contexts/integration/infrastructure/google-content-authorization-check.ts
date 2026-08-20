import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type {
  GoogleContentAuthorizationCheck,
  GoogleContentAuthorizationVector,
} from '#/shared/auth/google-content-authority'
import {
  GOOGLE_CONTENT_EXECUTION_POLICY_VERSION,
  type GoogleContentCapability,
} from '#/shared/auth/google-content-contract'
import { resolveMemberAuthContextWithDatabase } from '#/shared/auth/tenant-resolver'
import { googleAuthorizationPermissionDigest } from '#/shared/domain/google-content-authorization-vector'
import {
  canForContext,
  scopeForPermission,
  type Permission,
} from '#/shared/domain/permissions'
type GoogleContentAuthorizationCheckDeps = Readonly<{
  clock: () => Date
  hasActivePropertyGrant: (
    tx: Database,
    input: Readonly<{
      organizationId: string
      propertyId: string
      userId: string
      at: Date
    }>,
  ) => Promise<boolean>
}>

const deny = (code = 'authorization_denied') => ({ allowed: false as const, code })

export async function policyAuthorizes(
  tx: Database,
  capability: GoogleContentCapability,
  organizationId: string,
  propertyId: string | null,
): Promise<Readonly<{ version: number; emergencyKillVersion: number }> | null> {
  const result = await tx.execute(sql`
    SELECT pv.version, pv.emergency_kill_version
    FROM policy_version pv
    JOIN capability_execution_control control
      ON control.capability = ${capability}::google_content_capability
    WHERE pv.scope = 'global'
      AND control.denied = false
      AND control.emergency_kill_version = pv.emergency_kill_version
      AND NOT EXISTS (
        SELECT 1 FROM organization_policy policy
        WHERE policy.organization_id = ${organizationId}
          AND policy.suspended_at IS NOT NULL
      )
      AND EXISTS (
        SELECT 1 FROM organization_capability allowed
        WHERE allowed.organization_id = ${organizationId}
          AND allowed.capability = ${capability}
      )
      AND (
        ${propertyId}::uuid IS NULL
        OR (
          EXISTS (
            SELECT 1 FROM properties property
            WHERE property.id = ${propertyId}::uuid
              AND property.organization_id = ${organizationId}
              AND property.deleted_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM property_policy policy
            WHERE policy.property_id = ${propertyId}::uuid
              AND policy.suspended_at IS NOT NULL
          )
          AND EXISTS (
            SELECT 1 FROM property_capability allowed
            WHERE allowed.property_id = ${propertyId}::uuid
              AND allowed.capability = ${capability}
          )
        )
      )
    LIMIT 1
  `)
  const row = result.rows[0] as
    | { version: number | string; emergency_kill_version: number | string }
    | undefined
  return row
    ? {
        version: Number(row.version),
        emergencyKillVersion: Number(row.emergency_kill_version),
      }
    : null
}

export function createGoogleContentAuthorizationCheck(
  deps: GoogleContentAuthorizationCheckDeps,
): GoogleContentAuthorizationCheck<Database> {
  return async (tx, input) => {
    if (!input.scope.initiatorUserId || !input.scope.connectionId) return deny()

    const memberResult = await tx.execute(sql`
      SELECT role FROM member
      WHERE "organizationId" = ${input.scope.organizationId}
        AND "userId" = ${input.scope.initiatorUserId}
      LIMIT 1
    `)
    const member = memberResult.rows[0] as { role: string } | undefined
    if (!member) return deny()

    let actor
    try {
      actor = (
        await resolveMemberAuthContextWithDatabase(tx, {
          memberRole: member.role,
          organizationId: input.scope.organizationId,
          userId: input.scope.initiatorUserId,
        })
      ).context
    } catch {
      return deny('authorization_unavailable')
    }

    const permission = input.capability as Permission
    if (!canForContext(actor, permission)) return deny()
    const scope = scopeForPermission(actor, permission)
    if (scope === 'none') return deny()
    if (scope === 'assigned-properties' && input.scope.propertyId) {
      const hasGrant = await deps.hasActivePropertyGrant(tx, {
        organizationId: input.scope.organizationId,
        propertyId: input.scope.propertyId,
        userId: input.scope.initiatorUserId,
        at: deps.clock(),
      })
      if (!hasGrant) return deny()
    }

    const policy = await policyAuthorizes(
      tx,
      input.capability,
      input.scope.organizationId,
      input.scope.propertyId,
    )
    if (!policy) return deny()

    const connectionResult = await tx.execute(sql`
      SELECT lifecycle_version, access_version, credential_generation
      FROM google_connections
      WHERE id = ${input.scope.connectionId}::uuid
        AND organization_id = ${input.scope.organizationId}
        AND status = 'active'
        AND credential_use_state = 'active'
        AND (
          visibility = 'organization'
          OR connected_by = ${input.scope.initiatorUserId}
        )
      LIMIT 1
    `)
    const connection = connectionResult.rows[0] as
      | {
          lifecycle_version: number
          access_version: number
          credential_generation: number
        }
      | undefined
    if (!connection) return deny()
    let propertyVector: GoogleContentAuthorizationVector = Object.freeze({})
    if (input.scope.propertyId !== null) {
      const propertyResult = await tx.execute(sql`
        SELECT
          source_epoch,
          profile_version,
          google_binding_state,
          lifecycle_state,
          profile_source,
          profile_confirmed_at
        FROM properties
        WHERE id = ${input.scope.propertyId}::uuid
          AND organization_id = ${input.scope.organizationId}
          AND google_connection_id = ${input.scope.connectionId}::uuid
          AND gbp_location_id IS NOT NULL
          AND deleted_at IS NULL
          AND lifecycle_state = 'active'
          AND google_binding_state = 'active'
        LIMIT 1
      `)
      const property = propertyResult.rows[0] as
        | {
            source_epoch: number
            profile_version: number
            google_binding_state: string
            lifecycle_state: string
            profile_source: string
            profile_confirmed_at: Date | string | null
          }
        | undefined
      if (
        !property ||
        (input.capability === 'property.read_gbp_performance' &&
          (property.profile_source !== 'tenant_confirmed' ||
            property.profile_confirmed_at === null))
      ) {
        return deny()
      }
      propertyVector = Object.freeze({
        propertySourceEpoch: Number(property.source_epoch),
        propertyProfileVersion: Number(property.profile_version),
        propertyBindingState: property.google_binding_state,
        propertyLifecycleState: property.lifecycle_state,
        propertyProfileSource: property.profile_source,
        propertyTimezoneConfirmed: property.profile_confirmed_at !== null,
      })
    }

    return {
      allowed: true,
      vector: {
        executionPolicyVersion: GOOGLE_CONTENT_EXECUTION_POLICY_VERSION,
        googleContentPolicyVersion: policy.version,
        emergencyKillVersion: policy.emergencyKillVersion,
        role: actor.role,
        permissionDigest: googleAuthorizationPermissionDigest(actor),
        connectionLifecycleVersion: Number(connection.lifecycle_version),
        connectionAccessVersion: Number(connection.access_version),
        credentialGeneration: Number(connection.credential_generation),
        ...propertyVector,
      },
    }
  }
}
