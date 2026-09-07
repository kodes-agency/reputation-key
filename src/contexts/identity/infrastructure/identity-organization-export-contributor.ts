import { sql, type SQL } from 'drizzle-orm'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type { Database } from '#/shared/db'
// Identity's own contributor implements the same port the sixteen foreign
// contributors implement, so this file stays the reference shape for them.
import type {
  OrganizationExportContributor,
  OrganizationExportEntry,
} from '../application/ports/organization-export-contributor.port'

type ExportScalar = string | number | boolean | null
type ExportRecord = Readonly<Record<string, ExportScalar>>

type IdentityOrganizationExportPayload = Readonly<{
  version: 'identity-organization-export/v1'
  requestedAsOf: string
  snapshotBound: 'repeatable_read_within_15m_of_request'
  organization: ExportRecord
  members: readonly ExportRecord[]
  invitations: readonly ExportRecord[]
  customRoles: readonly ExportRecord[]
  rolePolicies: readonly ExportRecord[]
  userBindings: readonly ExportRecord[]
  canonicalPropertyAccessGrants: readonly ExportRecord[]
  compatibilityPropertyAccessGrants: readonly ExportRecord[]
  organizationPolicies: readonly ExportRecord[]
  organizationCapabilities: readonly ExportRecord[]
  propertyPolicies: readonly ExportRecord[]
  propertyCapabilities: readonly ExportRecord[]
  policyConsents: readonly ExportRecord[]
  lifecycleAuthority: readonly ExportRecord[]
  excludedRecordClasses: readonly Readonly<{
    recordClass: string
    reasonCode: string
  }>[]
}>

const MAX_SNAPSHOT_LAG_MS = 15 * 60 * 1000

const EXCLUDED_RECORD_CLASSES = Object.freeze([
  {
    recordClass: 'authentication_accounts_and_credentials',
    reasonCode: 'security_secret_material',
  },
  { recordClass: 'sessions', reasonCode: 'security_session_material' },
  { recordClass: 'verification_challenges', reasonCode: 'security_secret_material' },
  {
    recordClass: 'invited_registration_recovery_authority',
    reasonCode: 'operational_recovery_control',
  },
  {
    recordClass: 'organization_export_and_lifecycle_receipts',
    reasonCode: 'content_free_control_plane',
  },
  {
    recordClass: 'beta_feedback_provider_triage',
    reasonCode: 'restricted_support_control_plane',
  },
])

function normalizeScalar(value: unknown, field: string): ExportScalar {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error(`Identity export field is invalid: ${field}`)
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  throw new Error(`Identity export field has an unsupported value: ${field}`)
}

function normalizeRows(rows: readonly Record<string, unknown>[]): ExportRecord[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([field, value]) => [field, normalizeScalar(value, field)]),
    ),
  )
}

async function readRows(
  snapshot: Parameters<Parameters<Database['transaction']>[0]>[0],
  query: SQL,
): Promise<ExportRecord[]> {
  const result = await snapshot.execute(query)
  return normalizeRows(result.rows as Record<string, unknown>[])
}

function csvField(value: ExportScalar | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function csvSummary(type: string, record: ExportRecord): readonly ExportScalar[] {
  const id =
    record.id ??
    record.organization_id ??
    record.user_id ??
    record.property_id ??
    record.subject_id ??
    ''
  const label = record.name ?? record.email ?? record.role ?? record.capability ?? ''
  const state =
    record.state ?? record.status ?? record.cohort ?? record.data_scope ?? 'recorded'
  const createdAt =
    record.created_at ?? record.joined_at ?? record.recorded_at ?? record.granted_at ?? ''
  const updatedAt = record.updated_at ?? record.revoked_at ?? record.released_at ?? ''
  return [
    type,
    id,
    record.property_id ?? '',
    record.user_id ?? '',
    label,
    state,
    createdAt,
    updatedAt,
    canonicalizeRfc8785(record),
  ]
}

function csvEntry(payload: IdentityOrganizationExportPayload): OrganizationExportEntry {
  const collections: readonly [string, readonly ExportRecord[]][] = [
    ['organization', [payload.organization]],
    ['member', payload.members],
    ['invitation', payload.invitations],
    ['custom_role', payload.customRoles],
    ['role_policy', payload.rolePolicies],
    ['user_binding', payload.userBindings],
    ['property_access_grant', payload.canonicalPropertyAccessGrants],
    ['compatibility_property_access_grant', payload.compatibilityPropertyAccessGrants],
    ['organization_policy', payload.organizationPolicies],
    ['organization_capability', payload.organizationCapabilities],
    ['property_policy', payload.propertyPolicies],
    ['property_capability', payload.propertyCapabilities],
    ['policy_consent', payload.policyConsents],
    ['lifecycle_authority', payload.lifecycleAuthority],
  ]
  const header = [
    'record_type',
    'record_id',
    'property_id',
    'user_id',
    'label',
    'state',
    'created_at',
    'updated_at',
    'record_json',
  ]
  const lines = [
    header.join(','),
    ...collections.flatMap(([type, records]) =>
      records.map((record) => csvSummary(type, record).map(csvField).join(',')),
    ),
  ]
  return {
    path: 'identity/organization.csv',
    mediaType: 'text/csv',
    classification: 'tenant_visible',
    bytes: Buffer.from(`${lines.join('\n')}\n`, 'utf8'),
  }
}

function jsonEntry(payload: IdentityOrganizationExportPayload): OrganizationExportEntry {
  return {
    path: 'identity/organization.json',
    mediaType: 'application/json',
    classification: 'tenant_visible',
    bytes: Buffer.from(`${canonicalizeRfc8785(payload)}\n`, 'utf8'),
  }
}

async function readPayload(
  db: Database,
  organizationId: string,
  asOf: Date,
): Promise<IdentityOrganizationExportPayload> {
  return db.transaction(
    async (snapshot) => {
      const snapshotRows = await readRows(
        snapshot,
        sql`SELECT transaction_timestamp() AS snapshot_at`,
      )
      const snapshotAt = snapshotRows[0]?.snapshot_at
      if (typeof snapshotAt !== 'string') {
        throw new Error('Identity export snapshot clock is unavailable')
      }
      const snapshotTime = new Date(snapshotAt).getTime()
      const requestTime = asOf.getTime()
      if (
        Number.isNaN(requestTime) ||
        snapshotTime < requestTime ||
        snapshotTime - requestTime > MAX_SNAPSHOT_LAG_MS
      ) {
        throw new Error('Identity export snapshot window is unavailable')
      }

      const organizations = await readRows(
        snapshot,
        sql`SELECT
              id,
              name,
              slug,
              logo,
              metadata,
              "contactEmail" AS contact_email,
              "billingCompanyName" AS billing_company_name,
              "billingAddress" AS billing_address,
              "billingCity" AS billing_city,
              "billingPostalCode" AS billing_postal_code,
              "billingCountry" AS billing_country,
              to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
            FROM organization
            WHERE id = ${organizationId}`,
      )
      if (organizations.length !== 1) {
        throw new Error('Identity export Organization was not found')
      }

      const members = await readRows(
        snapshot,
        sql`SELECT
              m.id,
              m."userId" AS user_id,
              u.name,
              u.email,
              u."emailVerified" AS email_verified,
              u.image,
              m.role,
              to_char(m."createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS joined_at,
              to_char(u."createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS user_created_at,
              to_char(u."updatedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS user_updated_at
            FROM member AS m
            INNER JOIN "user" AS u ON u.id = m."userId"
            WHERE m."organizationId" = ${organizationId}
            ORDER BY m."createdAt", m.id`,
      )
      const invitations = await readRows(
        snapshot,
        sql`SELECT
              id,
              email,
              role,
              status,
              to_char("expiresAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS expires_at,
              "propertyIds" AS property_ids,
              "inviterId" AS inviter_id,
              to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
            FROM invitation
            WHERE "organizationId" = ${organizationId}
            ORDER BY "createdAt", id`,
      )
      const customRoles = await readRows(
        snapshot,
        sql`SELECT
              id,
              role,
              permission,
              to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
              to_char("updatedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
            FROM "organizationRole"
            WHERE "organizationId" = ${organizationId}
            ORDER BY role, id`,
      )
      const rolePolicies = await readRows(
        snapshot,
        sql`SELECT
              id,
              role,
              data_scope,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
            FROM organization_role_policy
            WHERE organization_id = ${organizationId}
            ORDER BY role, id`,
      )
      const userBindings = await readRows(
        snapshot,
        sql`SELECT
              user_id,
              state,
              source,
              invitation_id,
              version,
              resolution_reason,
              to_char(released_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS released_at,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
            FROM user_organization_bindings
            WHERE organization_id = ${organizationId}
            ORDER BY user_id`,
      )
      const canonicalPropertyAccessGrants = await readRows(
        snapshot,
        sql`SELECT
              id,
              property_id,
              user_id,
              source,
              created_by,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
              to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS expires_at,
              to_char(revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS revoked_at,
              revoke_reason
            FROM property_access_grant
            WHERE organization_id = ${organizationId}
            ORDER BY property_id, user_id, created_at, id`,
      )
      const compatibilityPropertyAccessGrants = await readRows(
        snapshot,
        sql`SELECT
              id,
              property_id,
              user_id,
              kind,
              status,
              to_char(granted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS granted_at,
              to_char(revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS revoked_at,
              granted_by,
              revoked_by,
              reason
            FROM property_access_grants
            WHERE organization_id = ${organizationId}
            ORDER BY property_id, user_id, granted_at, id`,
      )
      const organizationPolicies = await readRows(
        snapshot,
        sql`SELECT
              organization_id,
              cohort,
              to_char(suspended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS suspended_at,
              suspended_reason,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
            FROM organization_policy
            WHERE organization_id = ${organizationId}`,
      )
      const organizationCapabilities = await readRows(
        snapshot,
        sql`SELECT capability, created_by,
                   to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
            FROM organization_capability
            WHERE organization_id = ${organizationId}
            ORDER BY capability`,
      )
      const propertyPolicies = await readRows(
        snapshot,
        sql`SELECT
              policy.property_id,
              to_char(policy.suspended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS suspended_at,
              policy.suspended_reason,
              to_char(policy.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
            FROM property_policy AS policy
            INNER JOIN properties AS property ON property.id = policy.property_id
            WHERE property.organization_id = ${organizationId}
            ORDER BY policy.property_id`,
      )
      const propertyCapabilities = await readRows(
        snapshot,
        sql`SELECT capability.property_id, capability.capability,
                   capability.created_by,
                   to_char(capability.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
            FROM property_capability AS capability
            INNER JOIN properties AS property ON property.id = capability.property_id
            WHERE property.organization_id = ${organizationId}
            ORDER BY capability.property_id, capability.capability`,
      )
      const policyConsents = await readRows(
        snapshot,
        sql`SELECT
              id,
              subject_type,
              subject_id,
              purpose,
              state,
              recorded_by,
              to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded_at,
              to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS expires_at,
              to_char(revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS revoked_at
            FROM policy_consent
            WHERE organization_id = ${organizationId}
            ORDER BY recorded_at, id`,
      )
      const lifecycleAuthority = await readRows(
        snapshot,
        sql`SELECT
              organization_id,
              state,
              revision,
              to_char(closure_requested_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS closure_requested_at,
              to_char(recoverable_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recoverable_until,
              to_char(irreversible_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS irreversible_at,
              to_char(closed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS closed_at,
              reactivation_required,
              request_reason_code,
              to_char(last_transition_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_transition_at,
              last_reason_code
            FROM organization_lifecycle_authority
            WHERE organization_id = ${organizationId}`,
      )

      return {
        version: 'identity-organization-export/v1',
        requestedAsOf: asOf.toISOString(),
        snapshotBound: 'repeatable_read_within_15m_of_request',
        organization: organizations[0]!,
        members,
        invitations,
        customRoles,
        rolePolicies,
        userBindings,
        canonicalPropertyAccessGrants,
        compatibilityPropertyAccessGrants,
        organizationPolicies,
        organizationCapabilities,
        propertyPolicies,
        propertyCapabilities,
        policyConsents,
        lifecycleAuthority,
        excludedRecordClasses: EXCLUDED_RECORD_CLASSES,
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

/**
 * Concrete Identity-owned Organization Export contribution.
 *
 * Only tenant-visible profile, people-directory, access-policy, and lifecycle
 * status are selected. Authentication and recovery secrets are not queried.
 * A read-only repeatable-read snapshot is bounded to fifteen minutes after the
 * request; a stale queued request fails closed and must be replaced.
 */
export const createIdentityOrganizationExportContributor = (
  db: Database,
): OrganizationExportContributor => {
  return Object.freeze({
    context: 'identity' as const,
    async contribute({ organizationId, asOf }) {
      const payload = await readPayload(db, organizationId, asOf)
      return {
        context: 'identity' as const,
        coverage: 'complete' as const,
        omissionCodes: [],
        entries: [csvEntry(payload), jsonEntry(payload)],
      }
    },
  })
}
