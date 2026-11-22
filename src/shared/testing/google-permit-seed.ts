// Raw rows for the Google admission permit suites: an admitted permit with its
// authorization vector, the permission head it was admitted under, and the
// Property, manager and grant rows that permits for a Property refer to.

import type { Pool } from 'pg'

type SeedPool = Pick<Pool, 'query'>

export const PERMIT_PROJECT_FINGERPRINT = 'b'.repeat(64)

type CompiledAdmission = Readonly<{
  routeKey: string
  catalogueVersion: string
  admission: Readonly<{
    quotaPolicyId: string
    requestBindingSha256: string
    credentialBinding: string
    requestBodySha256: string | null
    requestBodyBytes: number
  }>
}>

/** The request-bound members of an authorization vector for one compiled request. */
export function admissionBindings(compiled: CompiledAdmission) {
  return {
    requestBindingSha256: compiled.admission.requestBindingSha256,
    credentialBinding: compiled.admission.credentialBinding,
    projectFingerprint: PERMIT_PROJECT_FINGERPRINT,
    requestBodySha256: compiled.admission.requestBodySha256,
    requestBodyBytes: compiled.admission.requestBodyBytes,
  }
}

export async function currentPermissionVersion(
  pool: SeedPool,
  organizationId: string,
): Promise<number> {
  const permission = await pool.query<{ version: string }>(
    'SELECT version FROM permission_version WHERE organization_id = $1',
    [organizationId],
  )
  const version = permission.rows[0]?.version
  if (version === undefined) throw new Error('expected current permission version')
  return Number(version)
}

export type AdmittedPermitSeed = Readonly<{
  id: string
  capability: string
  organizationId: string
  propertyId?: string | null
  connectionId: string
  initiatorUserId: string | null
  operationKey: string
  compiled: CompiledAdmission
  vector: Readonly<Record<string, unknown>>
  admittedAt?: Date
  startDeadlineAt?: Date
}>

const START_WINDOW_MS = 30_000

export async function insertAdmittedPermit(
  pool: SeedPool,
  permit: AdmittedPermitSeed,
): Promise<void> {
  const admittedAt = permit.admittedAt ?? new Date()
  await pool.query(
    `INSERT INTO authorization_execution_permits (
      id, capability, organization_id, property_id, connection_id,
      initiator_user_id, operation_key, route_key, route_catalog_version,
      quota_policy_id, authorization_vector, state, admitted_at,
      start_deadline_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, 'admitted', $12, $13
    )`,
    [
      permit.id,
      permit.capability,
      permit.organizationId,
      permit.propertyId ?? null,
      permit.connectionId,
      permit.initiatorUserId,
      permit.operationKey,
      permit.compiled.routeKey,
      permit.compiled.catalogueVersion,
      permit.compiled.admission.quotaPolicyId,
      JSON.stringify(permit.vector),
      admittedAt,
      permit.startDeadlineAt ?? new Date(admittedAt.getTime() + START_WINDOW_MS),
    ],
  )
}

export async function insertActiveGoogleProperty(
  pool: SeedPool,
  property: Readonly<{
    id: string
    organizationId: string
    connectionId: string
    name: string
    confirmedBy: string
  }>,
): Promise<void> {
  await pool.query(
    `INSERT INTO properties (
      id, organization_id, name, slug, timezone, google_connection_id,
      gbp_account_id, gbp_location_id, profile_version,
      google_binding_state, profile_source, profile_confirmed_at,
      profile_confirmed_by, lifecycle_state, source_epoch
    ) VALUES (
      $1::uuid, $2, $5, $1::text, 'Europe/Sofia', $3,
      '123', '456', 8, 'active', 'tenant_confirmed', now(),
      $4, 'active', 7
    )`,
    [
      property.id,
      property.organizationId,
      property.connectionId,
      property.confirmedBy,
      property.name,
    ],
  )
}

export async function insertAdminMember(
  pool: SeedPool,
  member: Readonly<{
    userId: string
    memberId: string
    organizationId: string
    name: string
  }>,
): Promise<void> {
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, $3, $2, true, now(), now())`,
    [member.userId, `${member.userId}@example.com`, member.name],
  )
  await pool.query(
    `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
     VALUES ($1, $2, $3, 'admin', now())`,
    [member.memberId, member.userId, member.organizationId],
  )
}

export async function insertOperatorPropertyGrant(
  pool: SeedPool,
  grant: Readonly<{
    organizationId: string
    propertyId: string
    userId: string
    createdBy: string
  }>,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO property_access_grant (
      organization_id, property_id, user_id, source, created_by
    ) VALUES ($1, $2, $3, 'operator', $4) RETURNING id`,
    [grant.organizationId, grant.propertyId, grant.userId, grant.createdBy],
  )
  return result.rows[0]!.id
}

export type CapabilityControlRow = Readonly<{
  denied: boolean
  emergency_kill_version: string
  denied_at: Date | null
  drained_at: Date | null
  cleanup_drained_at: Date | null
}>

export async function readCapabilityControl(
  pool: SeedPool,
  capability: string,
): Promise<CapabilityControlRow | undefined> {
  const control = await pool.query<CapabilityControlRow>(
    `SELECT denied, emergency_kill_version, denied_at, drained_at, cleanup_drained_at
       FROM capability_execution_control
      WHERE capability = $1`,
    [capability],
  )
  return control.rows[0]
}

export async function restoreCapabilityControl(
  pool: SeedPool,
  capability: string,
  prior: CapabilityControlRow | undefined,
): Promise<void> {
  if (!prior) return
  await pool.query(
    `UPDATE capability_execution_control
        SET denied = $1, emergency_kill_version = $2, denied_at = $3,
            drained_at = $4, cleanup_drained_at = $5
      WHERE capability = $6`,
    [
      prior.denied,
      prior.emergency_kill_version,
      prior.denied_at,
      prior.drained_at,
      prior.cleanup_drained_at,
      capability,
    ],
  )
}

/** Opens one capability for the run and puts its control row back afterwards. */
export async function withCapabilityOpen<T>(
  pool: SeedPool,
  capability: string,
  run: () => Promise<T>,
): Promise<T> {
  const prior = await readCapabilityControl(pool, capability)
  try {
    await pool.query(
      `UPDATE capability_execution_control
          SET denied = false,
              denied_at = NULL, drained_at = NULL, cleanup_drained_at = NULL
        WHERE capability = $1`,
      [capability],
    )
    return await run()
  } finally {
    await restoreCapabilityControl(pool, capability, prior)
  }
}
