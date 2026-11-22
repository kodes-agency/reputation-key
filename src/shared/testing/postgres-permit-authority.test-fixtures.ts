import { afterAll, beforeAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { withLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { deleteTestOrganizations } from './integration-helpers'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_SEGMENTS,
} from './google-provider-identifiers-v1'
import { seedGoogleConnection } from './google-connection-seed'
import {
  PERMIT_PROJECT_FINGERPRINT,
  admissionBindings,
  currentPermissionVersion,
  insertAdmittedPermit,
  readCapabilityControl,
  restoreCapabilityControl,
  type CapabilityControlRow,
} from './google-permit-seed'
import { compileGoogleProviderRequest } from '#/shared/google-provider-control/route-catalogue'
import { createPostgresGoogleAdmissionPermitAuthority } from '#/shared/google-provider-control/postgres-permit-authority'

export const ORGANIZATION_ID = 'org-google-admission-authority-test'
export const USER_ID = 'user-google-admission-authority-test'
const MEMBER_ID = 'member-google-admission-authority-test'
export const CONNECTION_ID = '8e000000-0000-4000-8000-000000000001'
export const PERMIT_ID = '8d000000-0000-4000-8000-000000000001'
export const CLEANUP_PERMIT_ID = '8d000000-0000-4000-8000-000000000002'
export const DISCONNECT_ATTEMPT_ID = '8d000000-0000-4000-8000-000000000007'
export const DISCONNECT_PERMIT_ID = '8d000000-0000-4000-8000-000000000008'
export const PROJECT_FINGERPRINT = PERMIT_PROJECT_FINGERPRINT
const IMPORT_CAPABILITY = 'property.import_gbp_v2'
const NOW = new Date()

const bindCredential = (credential: string) =>
  credential === 'access-token' ? 'a'.repeat(64) : 'c'.repeat(64)
export const compiled = compileGoogleProviderRequest(
  {
    routeKey: 'account-management.accounts.list',
    accessToken: 'access-token',
  },
  bindCredential,
)
export const compiledCleanup = compileGoogleProviderRequest(
  { routeKey: 'oauth.revoke', token: 'access-token' },
  bindCredential,
)
export const compiledOAuthExchange = compileGoogleProviderRequest(
  {
    routeKey: 'oauth.token.exchange',
    code: 'single-use-authorization-code',
    clientId: 'oauth-client-id',
    clientSecret: 'oauth-client-secret',
    redirectUri: 'https://app.example.test/api/auth/google/callback',
    codeVerifier: 'pkce-verifier',
  },
  bindCredential,
)
export const compiledReviewList = compileGoogleProviderRequest(
  {
    routeKey: 'reviews.list',
    accessToken: 'access-token',
    locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
  },
  bindCredential,
)
export const compiledPerformance = compileGoogleProviderRequest(
  {
    routeKey: 'performance.fetch',
    accessToken: 'access-token',
    locationId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.locationId,
    startLocalDate: '2026-08-01',
    endLocalDate: '2026-08-07',
  },
  bindCredential,
)
export const compiledReply = compileGoogleProviderRequest(
  {
    routeKey: 'reviews.reply',
    accessToken: 'access-token',
    reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
    comment: 'Thank you for your review.',
  },
  bindCredential,
)

export const vector = Object.freeze({
  executionPolicyVersion: 'beta-local-2',
  principalKind: 'user',
  role: 'AccountAdmin',
  permissionVersion: 0,
  permissionDigest: 'd'.repeat(64),
  connectionLifecycleVersion: 1,
  connectionAccessVersion: 1,
  credentialGeneration: 1,
  ...admissionBindings(compiled),
})

/** The Property members of a vector for a Property bound to the shared connection. */
export const ACTIVE_PROPERTY_VECTOR = Object.freeze({
  propertySourceEpoch: 7,
  propertyProfileVersion: 8,
  propertyBindingState: 'active',
  propertyLifecycleState: 'active',
  propertyProfileSource: 'tenant_confirmed',
  propertyTimezoneConfirmed: true,
})

registerAllEventSchemas()

let pool: Pool
let originalControl: CapabilityControlRow | undefined

export const harness = {
  get pool(): Pool {
    return pool
  },
}

export function authority() {
  return createPostgresGoogleAdmissionPermitAuthority({ pool })
}

export async function loadSnapshot(permitId: string, what = 'permit snapshot') {
  const snapshot = await authority().load(permitId)
  if (!snapshot) throw new Error(`expected ${what}`)
  return snapshot
}

export async function readPermit(permitId: string, columns: string) {
  const result = await pool.query(
    `SELECT ${columns} FROM authorization_execution_permits WHERE id = $1`,
    [permitId],
  )
  return result.rows[0]
}

async function seedPermit(): Promise<void> {
  await insertAdmittedPermit(pool, {
    id: PERMIT_ID,
    capability: IMPORT_CAPABILITY,
    organizationId: ORGANIZATION_ID,
    connectionId: CONNECTION_ID,
    initiatorUserId: USER_ID,
    operationKey: 'account-discovery',
    compiled,
    vector: {
      ...vector,
      permissionVersion: await currentPermissionVersion(pool, ORGANIZATION_ID),
    },
    admittedAt: NOW,
  })
}

export async function seedUnlinkedCleanupPermit(): Promise<void> {
  await insertAdmittedPermit(pool, {
    id: CLEANUP_PERMIT_ID,
    capability: IMPORT_CAPABILITY,
    organizationId: ORGANIZATION_ID,
    connectionId: CONNECTION_ID,
    initiatorUserId: USER_ID,
    operationKey: 'provider.oauth.revoke',
    compiled: compiledCleanup,
    vector: { ...vector, ...admissionBindings(compiledCleanup) },
    admittedAt: NOW,
  })
}

async function clearReceiptsAndOutbox(): Promise<void> {
  await pool.query(
    `DELETE FROM idempotency_receipts
     WHERE scope = 'google_disconnect_revoke'
       AND payload->>'organizationId' = $1`,
    [ORGANIZATION_ID],
  )
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [
    ORGANIZATION_ID,
  ])
}

const deleteOrganizationPermits = () =>
  pool.query('DELETE FROM authorization_execution_permits WHERE organization_id = $1', [
    ORGANIZATION_ID,
  ])

/** Registers the shared tenant, connection and import-capability state for a suite. */
export function usePermitAuthorityHarness(): void {
  beforeAll(async () => {
    pool = new Pool({ connectionString: getEnv().DATABASE_URL })
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'Google Admission Authority', $1, now())
       ON CONFLICT (id) DO NOTHING`,
      [ORGANIZATION_ID],
    )
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, 'Google Admission User', 'google-admission-authority@example.com', true, now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [USER_ID],
    )
    await pool.query(
      `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
       VALUES ($1, $2, $3, 'owner', now())
       ON CONFLICT (id) DO NOTHING`,
      [MEMBER_ID, USER_ID, ORGANIZATION_ID],
    )
    await seedGoogleConnection(pool, {
      id: CONNECTION_ID,
      organizationId: ORGANIZATION_ID,
      googleSubject: 'google-admission-authority-subject',
      accessToken: 'encrypted-access',
      refreshToken: 'encrypted-refresh',
      scopes: ['test'],
      connectedBy: 'former-google-connector',
      onExistingId: 'keep',
    })
    originalControl = await readCapabilityControl(pool, IMPORT_CAPABILITY)
  })

  beforeEach(async () => {
    await clearReceiptsAndOutbox()
    await pool.query(
      `UPDATE google_connections
          SET status = 'active', credential_use_state = 'active',
              visibility = 'organization', lifecycle_version = 1,
              access_version = 1, credential_generation = 1,
              connected_by = 'former-google-connector',
              google_subject = 'google-admission-authority-subject',
              encrypted_access_token = 'encrypted-access',
              encrypted_refresh_token = 'encrypted-refresh',
              scopes = ARRAY['test']::text[],
              cleanup_material_deadline_at = NULL,
              status_reason = NULL
        WHERE id = $1`,
      [CONNECTION_ID],
    )
    await pool.query(
      `UPDATE capability_execution_control
          SET denied = false,
              denied_at = NULL,
              drained_at = NULL,
              cleanup_drained_at = NULL
        WHERE capability = 'property.import_gbp_v2'`,
    )
    await deleteOrganizationPermits()
    await seedPermit()
  })

  afterAll(async () => {
    await clearReceiptsAndOutbox()
    await deleteOrganizationPermits()
    await restoreCapabilityControl(pool, IMPORT_CAPABILITY, originalControl)
    await pool.query('DELETE FROM google_connections WHERE id = $1', [CONNECTION_ID])
    await withLastOwnerGuardDisabled(pool, async (client) => {
      await client.query('DELETE FROM member WHERE id = $1', [MEMBER_ID])
      await client.query('DELETE FROM "user" WHERE id = $1', [USER_ID])
      await deleteTestOrganizations(client, [ORGANIZATION_ID])
    })
    await pool.end()
  })
}
