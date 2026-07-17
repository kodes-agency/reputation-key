// BQC-2.2 — PropertyAccessGrant repository (real PostgreSQL).
//
// The authoritative grant model (phase BQC-2 §2.2/2.3): a user's access to a
// property exists only as a row here — never inferred from staff assignment,
// team membership, or portal participation. Tenant consistency is enforced by
// the composite FK to properties(organization_id, id); one active grant per
// (org, property, user) by partial unique index.
//
// Every mutation bumps the global policy_version in the same statement.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { BUMP_POLICY_VERSION_SQL } from './policy-version-sql'
import type {
  GrantSource,
  PropertyAccessGrantRecord,
} from '../../application/ports/property-access-grant.port'

// The record contract lives in application/ports (boundary rule); re-exported
// here for the repository's existing consumers.
export type { GrantSource, PropertyAccessGrantRecord }

export type GrantPropertyAccessInput = Readonly<{
  organizationId: string
  propertyId: string
  userId: string
  source: GrantSource
  createdBy?: string
  expiresAt?: Date
}>

function mapGrant(r: Record<string, unknown>): PropertyAccessGrantRecord {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    propertyId: r.property_id as string,
    userId: r.user_id as string,
    source: r.source as GrantSource,
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: toDate(r.created_at)!,
    expiresAt: toDate(r.expires_at),
    revokedAt: toDate(r.revoked_at),
    revokeReason: (r.revoke_reason as string | null) ?? null,
  }
}

/** pg returns timestamptz as Date or string depending on driver path — normalize. */
function toDate(v: unknown): Date | null {
  if (v == null) return null
  return v instanceof Date ? v : new Date(v as string)
}

export async function grantPropertyAccess(
  db: Database,
  input: GrantPropertyAccessInput,
): Promise<PropertyAccessGrantRecord> {
  const rows = await db.execute(sql`
    WITH ${BUMP_POLICY_VERSION_SQL},
    ins AS (
      INSERT INTO property_access_grant
        (organization_id, property_id, user_id, source, created_by, expires_at)
      VALUES (
        ${input.organizationId},
        ${input.propertyId},
        ${input.userId},
        ${input.source},
        ${input.createdBy ?? null},
        ${input.expiresAt ?? null}
      )
      RETURNING *
    )
    SELECT * FROM ins
  `)
  return mapGrant(rows.rows[0] as Record<string, unknown>)
}

export async function revokePropertyAccess(
  db: Database,
  input: Readonly<{
    organizationId: string
    propertyId: string
    userId: string
    reason?: string
  }>,
): Promise<boolean> {
  const rows = await db.execute(sql`
    WITH ${BUMP_POLICY_VERSION_SQL},
    upd AS (
      UPDATE property_access_grant
      SET revoked_at = now(), revoke_reason = ${input.reason ?? null}
      WHERE organization_id = ${input.organizationId}
        AND property_id = ${input.propertyId}
        AND user_id = ${input.userId}
        AND revoked_at IS NULL
      RETURNING id
    )
    SELECT id FROM upd
  `)
  return rows.rows.length > 0
}

export async function listActiveGrantsForUser(
  db: Database,
  organizationId: string,
  userId: string,
  at: Date,
): Promise<ReadonlyArray<PropertyAccessGrantRecord>> {
  const rows = await db.execute(sql`
    SELECT * FROM property_access_grant
    WHERE organization_id = ${organizationId}
      AND user_id = ${userId}
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > ${at})
    ORDER BY created_at
  `)
  return rows.rows.map((r) => mapGrant(r as Record<string, unknown>))
}

export async function hasActiveGrant(
  db: Database,
  input: Readonly<{
    organizationId: string
    propertyId: string
    userId: string
    at: Date
  }>,
): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT 1 AS one FROM property_access_grant
    WHERE organization_id = ${input.organizationId}
      AND property_id = ${input.propertyId}
      AND user_id = ${input.userId}
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > ${input.at})
    LIMIT 1
  `)
  return rows.rows.length > 0
}

/** All active grants in an org — the policy-admin surface read (BQC-2.7). */
export async function listActiveGrantsForOrg(
  db: Database,
  organizationId: string,
  at: Date,
): Promise<ReadonlyArray<PropertyAccessGrantRecord>> {
  const rows = await db.execute(sql`
    SELECT * FROM property_access_grant
    WHERE organization_id = ${organizationId}
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > ${at})
    ORDER BY property_id, user_id
  `)
  return rows.rows.map((r) => mapGrant(r as Record<string, unknown>))
}
