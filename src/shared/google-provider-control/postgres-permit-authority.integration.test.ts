import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { getEnv } from '#/shared/config/env'
import { withLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { withPublicationAuthorizationFixtureMutation } from '#/shared/testing/reply-publication-authorization-fixtures'
import { googleReplyTextDigest } from '#/shared/domain/google-reply-text'
import { getDb } from '#/shared/db'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { googleConnectionId, organizationId } from '#/shared/domain/ids'
import { createGoogleDisconnectRevokeRepository } from '#/contexts/integration/infrastructure/repositories/google-disconnect-revoke.repository'
import { compileGoogleProviderRequest } from './route-catalogue'
import { createPostgresGoogleAdmissionPermitAuthority } from './postgres-permit-authority'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_SEGMENTS,
} from '#/test-fixtures/generated/google-provider-identifiers-v1'

const ORGANIZATION_ID = 'org-google-admission-authority-test'
const USER_ID = 'user-google-admission-authority-test'
const MEMBER_ID = 'member-google-admission-authority-test'
const CONNECTION_ID = '8e000000-0000-4000-8000-000000000001'
const PERMIT_ID = '8d000000-0000-4000-8000-000000000001'
const CLEANUP_PERMIT_ID = '8d000000-0000-4000-8000-000000000002'
const SOURCE_WORK_PERMIT_ID = '8d000000-0000-4000-8000-000000000003'
const SOURCE_OPERATION_ID = '8d000000-0000-4000-8000-000000000004'
const REVOKE_PERMIT_ID = '8d000000-0000-4000-8000-000000000005'
const SUBJECT_GUARD_ID = '8d000000-0000-4000-8000-000000000006'
const DISCONNECT_ATTEMPT_ID = '8d000000-0000-4000-8000-000000000007'
const DISCONNECT_PERMIT_ID = '8d000000-0000-4000-8000-000000000008'
const NOW = new Date()
const RELEASE_SHA = 'a'.repeat(40)
const PROJECT_FINGERPRINT = 'b'.repeat(64)
const bindCredential = (credential: string) =>
  credential === 'access-token' ? 'a'.repeat(64) : 'c'.repeat(64)
const compiled = compileGoogleProviderRequest(
  {
    routeKey: 'account-management.accounts.list',
    accessToken: 'access-token',
  },
  bindCredential,
)
const compiledCleanup = compileGoogleProviderRequest(
  { routeKey: 'oauth.revoke', token: 'access-token' },
  bindCredential,
)
const compiledOAuthExchange = compileGoogleProviderRequest(
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
const compiledReviewList = compileGoogleProviderRequest(
  {
    routeKey: 'reviews.list',
    accessToken: 'access-token',
    locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
  },
  bindCredential,
)
const compiledPerformance = compileGoogleProviderRequest(
  {
    routeKey: 'performance.fetch',
    accessToken: 'access-token',
    locationId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.locationId,
    startLocalDate: '2026-08-01',
    endLocalDate: '2026-08-07',
  },
  bindCredential,
)
const compiledReply = compileGoogleProviderRequest(
  {
    routeKey: 'reviews.reply',
    accessToken: 'access-token',
    reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
    comment: 'Thank you for your review.',
  },
  bindCredential,
)
const vector = Object.freeze({
  executionPolicyVersion: 'beta-local-2',
  principalKind: 'user',
  role: 'AccountAdmin',
  permissionVersion: 0,
  permissionDigest: 'd'.repeat(64),
  connectionLifecycleVersion: 1,
  connectionAccessVersion: 1,
  credentialGeneration: 1,
  requestBindingSha256: compiled.admission.requestBindingSha256,
  credentialBinding: compiled.admission.credentialBinding,
  projectFingerprint: PROJECT_FINGERPRINT,
  requestBodySha256: compiled.admission.requestBodySha256,
  requestBodyBytes: compiled.admission.requestBodyBytes,
})

let pool: Pool
let originalControl:
  | Readonly<{
      denied: boolean
      emergency_kill_version: string
      denied_at: Date | null
      drained_at: Date | null
      cleanup_drained_at: Date | null
    }>
  | undefined

registerAllEventSchemas()

async function seedPermit(): Promise<void> {
  const permission = await pool.query<{ version: string }>(
    'SELECT version FROM permission_version WHERE organization_id = $1',
    [ORGANIZATION_ID],
  )
  const permissionVersion = permission.rows[0]?.version
  if (permissionVersion === undefined) throw new Error('expected permission version')
  await pool.query(
    `INSERT INTO authorization_execution_permits (
      id, capability, organization_id, connection_id, initiator_user_id,
      operation_key, route_key, route_catalog_version, quota_policy_id,
      authorization_vector, state, admitted_at, start_deadline_at
    ) VALUES (
      $1, 'property.import_gbp_v2', $2, $3, $10,
      'account-discovery', $4, $5, $6,
      $7::jsonb, 'admitted', $8, $9
    )`,
    [
      PERMIT_ID,
      ORGANIZATION_ID,
      CONNECTION_ID,
      compiled.routeKey,
      compiled.catalogueVersion,
      compiled.admission.quotaPolicyId,
      JSON.stringify({
        ...vector,
        permissionVersion: Number(permissionVersion),
      }),
      NOW,
      new Date(NOW.getTime() + 30_000),
      USER_ID,
    ],
  )
}

async function clearCredentialLifecycle(): Promise<void> {
  await pool.query(
    `DELETE FROM credential_revoke_permits
      WHERE source_operation_id IN (
        SELECT id FROM google_credential_source_operations WHERE organization_id = $1
      )`,
    [ORGANIZATION_ID],
  )
  await pool.query(
    'DELETE FROM google_credential_source_operations WHERE organization_id = $1',
    [ORGANIZATION_ID],
  )
  await pool.query('DELETE FROM google_subject_authority_guards WHERE id = $1', [
    SUBJECT_GUARD_ID,
  ])
}

async function seedDispatchingCleanupPermit(): Promise<void> {
  const cleanupVector = {
    ...vector,
    requestBindingSha256: compiledCleanup.admission.requestBindingSha256,
    credentialBinding: compiledCleanup.admission.credentialBinding,
    requestBodySha256: compiledCleanup.admission.requestBodySha256,
    requestBodyBytes: compiledCleanup.admission.requestBodyBytes,
  }
  await pool.query(
    `INSERT INTO authorization_execution_permits (
      id, capability, organization_id, connection_id, initiator_user_id,
      operation_key, route_key, route_catalog_version, quota_policy_id,
      authorization_vector, state, admitted_at, start_deadline_at,
      started_at, operation_deadline_at, completed_at
    ) VALUES (
      $1, 'property.import_gbp_v2', $2, $3, $4,
      'provider.oauth.token.refresh', 'oauth.token.refresh', $5, 'google-credential-refresh-v1',
      $6::jsonb, 'completed', $7, $8, $7, $8, $7
    )`,
    [
      SOURCE_WORK_PERMIT_ID,
      ORGANIZATION_ID,
      CONNECTION_ID,
      USER_ID,
      compiledCleanup.catalogueVersion,
      JSON.stringify(vector),
      new Date(NOW.getTime() - 2_000),
      new Date(NOW.getTime() + 60_000),
    ],
  )
  await pool.query(
    `INSERT INTO authorization_execution_permits (
      id, capability, organization_id, connection_id, initiator_user_id,
      operation_key, route_key, route_catalog_version, quota_policy_id,
      authorization_vector, state, admitted_at, start_deadline_at
    ) VALUES (
      $1, 'property.import_gbp_v2', $2, $3, $4,
      'provider.oauth.revoke', $5, $6, $7,
      $8::jsonb, 'admitted', $9, $10
    )`,
    [
      CLEANUP_PERMIT_ID,
      ORGANIZATION_ID,
      CONNECTION_ID,
      USER_ID,
      compiledCleanup.routeKey,
      compiledCleanup.catalogueVersion,
      compiledCleanup.admission.quotaPolicyId,
      JSON.stringify(cleanupVector),
      NOW,
      new Date(NOW.getTime() + 30_000),
    ],
  )
  await pool.query(
    `INSERT INTO google_subject_authority_guards (
      id, project_client_hmac_key_version, project_client_hmac,
      subject_hmac_key_version, subject_hmac, generation, next_sequence,
      source_cutoff_sequence, state, cleanup_deadline_at
    ) VALUES ($1, 'v1', $2, 'v1', $3, 1, 2, 1, 'cleanup_pending', $4)`,
    [SUBJECT_GUARD_ID, 'e'.repeat(43), 'f'.repeat(43), new Date(NOW.getTime() + 60_000)],
  )
  await pool.query(
    `INSERT INTO google_credential_source_operations (
      id, guard_id, source_work_permit_id, organization_id, connection_id,
      sequence, kind, state, expected_lifecycle_version,
      expected_access_version, expected_credential_generation,
      operation_deadline_at, provider_started_at, terminal_at, outcome_code,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, 1, 'refresh', 'terminal', 1, 1, 1,
      $6, $7, $8, 'rotated_credential_committed', $7, $8
    )`,
    [
      SOURCE_OPERATION_ID,
      SUBJECT_GUARD_ID,
      SOURCE_WORK_PERMIT_ID,
      ORGANIZATION_ID,
      CONNECTION_ID,
      new Date(NOW.getTime() + 60_000),
      new Date(NOW.getTime() - 2_000),
      new Date(NOW.getTime() - 1_000),
    ],
  )
  await pool.query(
    `INSERT INTO credential_revoke_permits (
      id, guard_id, source_operation_id, cleanup_work_permit_id, state,
      cleanup_deadline_at, activated_at, dispatching_at
    ) VALUES ($1, $2, $3, $4, 'dispatching', $5, $6, $7)`,
    [
      REVOKE_PERMIT_ID,
      SUBJECT_GUARD_ID,
      SOURCE_OPERATION_ID,
      CLEANUP_PERMIT_ID,
      new Date(NOW.getTime() + 60_000),
      new Date(NOW.getTime() - 1_000),
      NOW,
    ],
  )
}

function authority() {
  return createPostgresGoogleAdmissionPermitAuthority({
    pool,
    gatewayIdentity: 'google-egress-runtime-1',
    releaseSha: RELEASE_SHA,
  })
}

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
  await pool.query(
    `INSERT INTO google_connections (
       id, organization_id, google_subject, encrypted_access_token,
       encrypted_refresh_token, token_expires_at, scopes, connected_by,
       visibility, status, credential_use_state, lifecycle_version,
       access_version, credential_generation
     ) VALUES (
       $1, $2, 'google-admission-authority-subject', 'encrypted-access',
       'encrypted-refresh', now() + interval '1 hour', ARRAY['test'], $3,
       'organization', 'active', 'active', 1, 1, 1
     ) ON CONFLICT (id) DO NOTHING`,
    [CONNECTION_ID, ORGANIZATION_ID, 'former-google-connector'],
  )
  const control = await pool.query<NonNullable<typeof originalControl>>(
    `SELECT denied, emergency_kill_version, denied_at, drained_at, cleanup_drained_at
       FROM capability_execution_control
      WHERE capability = 'property.import_gbp_v2'`,
  )
  originalControl = control.rows[0]
})

beforeEach(async () => {
  await clearCredentialLifecycle()
  await pool.query(
    'DELETE FROM google_disconnect_revoke_attempts WHERE organization_id = $1',
    [ORGANIZATION_ID],
  )
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [
    ORGANIZATION_ID,
  ])
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
  await pool.query(
    'DELETE FROM authorization_execution_permits WHERE organization_id = $1',
    [ORGANIZATION_ID],
  )
  await seedPermit()
})

afterAll(async () => {
  await clearCredentialLifecycle()
  await pool.query(
    'DELETE FROM google_disconnect_revoke_attempts WHERE organization_id = $1',
    [ORGANIZATION_ID],
  )
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [
    ORGANIZATION_ID,
  ])
  await pool.query(
    'DELETE FROM authorization_execution_permits WHERE organization_id = $1',
    [ORGANIZATION_ID],
  )
  if (originalControl) {
    await pool.query(
      `UPDATE capability_execution_control
          SET denied = $1,
              emergency_kill_version = $2,
              denied_at = $3,
              drained_at = $4,
              cleanup_drained_at = $5
        WHERE capability = 'property.import_gbp_v2'`,
      [
        originalControl.denied,
        originalControl.emergency_kill_version,
        originalControl.denied_at,
        originalControl.drained_at,
        originalControl.cleanup_drained_at,
      ],
    )
  }
  await pool.query('DELETE FROM google_connections WHERE id = $1', [CONNECTION_ID])
  await withLastOwnerGuardDisabled(pool, async (client) => {
    await client.query('DELETE FROM member WHERE id = $1', [MEMBER_ID])
    await client.query('DELETE FROM "user" WHERE id = $1', [USER_ID])
    await deleteTestOrganizations(client, [ORGANIZATION_ID])
  })
  await pool.end()
})

describe('Postgres Google admission permit authority', () => {
  it('loads persisted scope dimensions and starts exactly one permit generation', async () => {
    const adapter = authority()
    const snapshot = await adapter.load(PERMIT_ID)
    if (!snapshot) throw new Error('expected permit snapshot')

    expect(snapshot.quotaKey).toMatchObject({
      organizationId: ORGANIZATION_ID,
      initiatorUserId: USER_ID,
      connectionId: CONNECTION_ID,
      propertyId: null,
      endpointClass: 'account-management',
    })
    await expect(adapter.start(snapshot)).resolves.toBe('started')
    await expect(adapter.start(snapshot)).resolves.toBe('changed')
    const result = await pool.query(
      `SELECT state,
        EXTRACT(EPOCH FROM (operation_deadline_at - started_at)) * 1000 AS operation_ms
       FROM authorization_execution_permits WHERE id = $1`,
      [PERMIT_ID],
    )
    expect(result.rows[0]?.state).toBe('started')
    expect(Number(result.rows[0]?.operation_ms)).toBe(30_000)
  })

  it('does not start when exact request authorization metadata drifts', async () => {
    const adapter = authority()
    const snapshot = await adapter.load(PERMIT_ID)
    if (!snapshot) throw new Error('expected permit snapshot')
    await pool.query(
      `UPDATE authorization_execution_permits
          SET authorization_vector = jsonb_set(
            authorization_vector,
            '{requestBodyBytes}',
            '1'::jsonb
          )
        WHERE id = $1`,
      [PERMIT_ID],
    )

    await expect(adapter.start(snapshot)).resolves.toBe('changed')
    const result = await pool.query(
      'SELECT state FROM authorization_execution_permits WHERE id = $1',
      [PERMIT_ID],
    )
    expect(result.rows[0]?.state).toBe('admitted')
  })

  it('does not accept a sparse provider binding through the database API', async () => {
    const adapter = authority()
    const snapshot = await adapter.load(PERMIT_ID)
    if (!snapshot) throw new Error('expected permit snapshot')
    const result = await pool.query<{ outcome: string }>(
      `SELECT outcome FROM start_google_execution_permit_v2(
        $1::uuid, $2::text, $3::text, $4::text, '{}'::jsonb, $5::text
      )`,
      [
        snapshot.permitId,
        snapshot.routeKey,
        snapshot.routeCatalogueVersion,
        snapshot.expectedAdmission.quotaPolicyId,
        RELEASE_SHA,
      ],
    )

    expect(result.rows[0]?.outcome).toBe('changed')
    const persisted = await pool.query(
      'SELECT state FROM authorization_execution_permits WHERE id = $1',
      [PERMIT_ID],
    )
    expect(persisted.rows[0]?.state).toBe('admitted')
  })

  it('starts a prospective OAuth exchange exactly once under concurrency', async () => {
    const prospectiveConnectionId = randomUUID()
    const permitId = randomUUID()
    const permission = await pool.query<{ version: string }>(
      'SELECT version FROM permission_version WHERE organization_id = $1',
      [ORGANIZATION_ID],
    )
    const permissionVersion = permission.rows[0]?.version
    if (permissionVersion === undefined) {
      throw new Error('expected current permission version')
    }
    try {
      await pool.query(
        `INSERT INTO authorization_execution_permits (
          id, capability, organization_id, connection_id, initiator_user_id,
          operation_key, route_key, route_catalog_version, quota_policy_id,
          authorization_vector, state, admitted_at, start_deadline_at
        ) VALUES (
          $1, 'property.import_gbp_v2', $2, $3, $4,
          'provider.oauth.token.exchange', $5, $6, $7,
          $8::jsonb, 'admitted', now(), now() + interval '30 seconds'
        )`,
        [
          permitId,
          ORGANIZATION_ID,
          prospectiveConnectionId,
          USER_ID,
          compiledOAuthExchange.routeKey,
          compiledOAuthExchange.catalogueVersion,
          compiledOAuthExchange.admission.quotaPolicyId,
          JSON.stringify({
            executionPolicyVersion: 'beta-local-2',
            principalKind: 'user',
            role: 'AccountAdmin',
            permissionVersion: Number(permissionVersion),
            permissionDigest: 'd'.repeat(64),
            oauthCredentialOperation: 'exchange_new',
            connectionLifecycleVersion: 0,
            connectionAccessVersion: 0,
            credentialGeneration: 0,
            requestBindingSha256: compiledOAuthExchange.admission.requestBindingSha256,
            credentialBinding: compiledOAuthExchange.admission.credentialBinding,
            projectFingerprint: PROJECT_FINGERPRINT,
            requestBodySha256: compiledOAuthExchange.admission.requestBodySha256,
            requestBodyBytes: compiledOAuthExchange.admission.requestBodyBytes,
          }),
        ],
      )

      const adapter = authority()
      const snapshot = await adapter.load(permitId)
      if (!snapshot) throw new Error('expected prospective exchange permit')
      const outcomes = await Promise.all([
        adapter.start(snapshot),
        adapter.start(snapshot),
      ])
      expect(outcomes.sort()).toEqual(['changed', 'started'])
      const persisted = await pool.query(
        `SELECT state,
          EXTRACT(EPOCH FROM (operation_deadline_at - started_at)) * 1000 AS operation_ms
         FROM authorization_execution_permits WHERE id = $1`,
        [permitId],
      )
      expect(persisted.rows[0]).toMatchObject({ state: 'started' })
      expect(Number(persisted.rows[0]?.operation_ms)).toBe(30_000)
    } finally {
      await pool.query('DELETE FROM authorization_execution_permits WHERE id = $1', [
        permitId,
      ])
    }
  })

  it('fences a human permit when the permission generation advances', async () => {
    const adapter = authority()
    const snapshot = await adapter.load(PERMIT_ID)
    if (!snapshot) throw new Error('expected permit snapshot')
    await pool.query(
      `UPDATE permission_version
          SET version = version + 1, updated_at = now()
        WHERE organization_id = $1`,
      [ORGANIZATION_ID],
    )

    await expect(adapter.start(snapshot)).resolves.toBe('changed')
    const result = await pool.query(
      'SELECT state, correlation_id FROM authorization_execution_permits WHERE id = $1',
      [PERMIT_ID],
    )
    expect(result.rows[0]).toEqual({
      state: 'fenced',
      correlation_id: 'authorization_changed',
    })
  })

  it('starts system review sync without connector-user authority', async () => {
    const property = randomUUID()
    const permitId = randomUUID()
    const original = await pool.query<NonNullable<typeof originalControl>>(
      `SELECT denied, emergency_kill_version, denied_at, drained_at, cleanup_drained_at
         FROM capability_execution_control
        WHERE capability = 'property.connect_gbp'`,
    )
    try {
      await pool.query(
        `INSERT INTO properties (
          id, organization_id, name, slug, timezone, google_connection_id,
          gbp_account_id, gbp_location_id, profile_version,
          google_binding_state, profile_source, profile_confirmed_at,
          profile_confirmed_by, lifecycle_state, source_epoch
        ) VALUES (
          $1::uuid, $2, 'Review sync property', $1::text, 'Europe/Sofia', $3,
          '123', '456', 8, 'active', 'tenant_confirmed', now(),
          $4, 'active', 7
        )`,
        [property, ORGANIZATION_ID, CONNECTION_ID, USER_ID],
      )
      await pool.query(
        `UPDATE capability_execution_control
            SET denied = false,
                denied_at = NULL, drained_at = NULL, cleanup_drained_at = NULL
          WHERE capability = 'property.connect_gbp'`,
      )
      await pool.query(
        `INSERT INTO authorization_execution_permits (
          id, capability, organization_id, property_id, connection_id,
          initiator_user_id, operation_key, route_key, route_catalog_version,
          quota_policy_id, authorization_vector, state, admitted_at,
          start_deadline_at
        ) VALUES (
          $1, 'property.connect_gbp', $2, $3, $4, NULL,
          'provider.reviews.list', $5, $6, $7,
          $8::jsonb, 'admitted', $9, $10
        )`,
        [
          permitId,
          ORGANIZATION_ID,
          property,
          CONNECTION_ID,
          compiledReviewList.routeKey,
          compiledReviewList.catalogueVersion,
          compiledReviewList.admission.quotaPolicyId,
          JSON.stringify({
            executionPolicyVersion: 'beta-local-2',
            principalKind: 'system',
            systemPrincipal: 'review-sync-worker-v1',
            role: 'System',
            permissionVersion: null,
            permissionDigest:
              '65da4b7ff2904448056791e99cea6bcf83adee8507a501d9b22d042d41373899',
            connectionLifecycleVersion: 1,
            connectionAccessVersion: 1,
            credentialGeneration: 1,
            propertySourceEpoch: 7,
            propertyProfileVersion: 8,
            propertyBindingState: 'active',
            propertyLifecycleState: 'active',
            propertyProfileSource: 'tenant_confirmed',
            propertyTimezoneConfirmed: true,
            requestBindingSha256: compiledReviewList.admission.requestBindingSha256,
            credentialBinding: compiledReviewList.admission.credentialBinding,
            projectFingerprint: PROJECT_FINGERPRINT,
            requestBodySha256: compiledReviewList.admission.requestBodySha256,
            requestBodyBytes: compiledReviewList.admission.requestBodyBytes,
          }),
          NOW,
          new Date(NOW.getTime() + 30_000),
        ],
      )

      const adapter = authority()
      const snapshot = await adapter.load(permitId)
      if (!snapshot) throw new Error('expected review sync permit snapshot')
      expect(snapshot.quotaKey.initiatorUserId).toBeNull()
      await expect(adapter.start(snapshot)).resolves.toBe('started')
    } finally {
      await pool.query('DELETE FROM authorization_execution_permits WHERE id = $1', [
        permitId,
      ])
      await pool.query('DELETE FROM properties WHERE id = $1', [property])
      const prior = original.rows[0]
      if (prior) {
        await pool.query(
          `UPDATE capability_execution_control
              SET denied = $1, emergency_kill_version = $2, denied_at = $3,
                  drained_at = $4, cleanup_drained_at = $5
            WHERE capability = 'property.connect_gbp'`,
          [
            prior.denied,
            prior.emergency_kill_version,
            prior.denied_at,
            prior.drained_at,
            prior.cleanup_drained_at,
          ],
        )
      }
    }
  })

  it('starts only the current durable reply-publication attempt under live manager authority', async () => {
    const property = randomUUID()
    const reviewId = randomUUID()
    const replyId = randomUUID()
    const managerUser = `publication-manager-${randomUUID()}`
    const managerMember = `publication-member-${randomUUID()}`
    const authorizationDigest = googleReplyTextDigest('Thank you for your review.')
    const permitIds: string[] = []
    const original = await pool.query<NonNullable<typeof originalControl>>(
      `SELECT denied, emergency_kill_version, denied_at, drained_at, cleanup_drained_at
         FROM capability_execution_control
        WHERE capability = 'property.publish_reply'`,
    )
    const seedPublicationPermit = async (
      overrides: Readonly<Record<string, string | number | boolean | null>> = {},
    ) => {
      const permitId = randomUUID()
      permitIds.push(permitId)
      const permission = await pool.query<{ version: string }>(
        `SELECT version FROM permission_version WHERE organization_id = $1`,
        [ORGANIZATION_ID],
      )
      const permissionVersion = permission.rows[0]?.version
      if (permissionVersion === undefined) {
        throw new Error('expected current permission version')
      }
      await pool.query(
        `INSERT INTO authorization_execution_permits (
          id, capability, organization_id, property_id, connection_id,
          initiator_user_id, operation_key, route_key, route_catalog_version,
          quota_policy_id, authorization_vector, state, admitted_at,
          start_deadline_at
        ) VALUES (
          $1, 'property.publish_reply', $2, $3, $4, NULL,
          'provider.reviews.reply', $5, $6, $7,
          $8::jsonb, 'admitted', $9, $10
        )`,
        [
          permitId,
          ORGANIZATION_ID,
          property,
          CONNECTION_ID,
          compiledReply.routeKey,
          compiledReply.catalogueVersion,
          compiledReply.admission.quotaPolicyId,
          JSON.stringify({
            executionPolicyVersion: 'beta-local-2',
            principalKind: 'system',
            systemPrincipal: 'reply-publication-worker-v1',
            role: 'System',
            permissionVersion: null,
            permissionDigest:
              '78f5439a163ad5264b40a99b8d1b02d3fe433b47ea838049ae5806d10b8bbfe3',
            confirmingActorUserId: managerUser,
            confirmingActorRole: 'PropertyManager',
            confirmingActorPermissionVersion: Number(permissionVersion),
            connectionLifecycleVersion: 1,
            connectionAccessVersion: 1,
            credentialGeneration: 1,
            propertySourceEpoch: 7,
            propertyProfileVersion: 8,
            propertyBindingState: 'active',
            propertyLifecycleState: 'active',
            propertyProfileSource: 'tenant_confirmed',
            propertyTimezoneConfirmed: true,
            reviewId,
            replyId,
            publicationCycle: 3,
            publicationAttemptNumber: 2,
            materialReviewRevision: 9,
            replyStateRevision: 1,
            baseObservationRevision: 4,
            expectedReplyDigest: authorizationDigest,
            requestBindingSha256: compiledReply.admission.requestBindingSha256,
            credentialBinding: compiledReply.admission.credentialBinding,
            projectFingerprint: PROJECT_FINGERPRINT,
            requestBodySha256: compiledReply.admission.requestBodySha256,
            requestBodyBytes: compiledReply.admission.requestBodyBytes,
            ...overrides,
          }),
          NOW,
          new Date(NOW.getTime() + 30_000),
        ],
      )
      const snapshot = await authority().load(permitId)
      if (!snapshot) throw new Error('expected reply publication permit')
      return snapshot
    }

    try {
      await pool.query(
        `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         VALUES ($1, 'Reply publication manager', $2, true, now(), now())`,
        [managerUser, `${managerUser}@example.com`],
      )
      await pool.query(
        `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
         VALUES ($1, $2, $3, 'admin', now())`,
        [managerMember, managerUser, ORGANIZATION_ID],
      )
      await pool.query(
        `INSERT INTO properties (
          id, organization_id, name, slug, timezone, google_connection_id,
          gbp_account_id, gbp_location_id, profile_version,
          google_binding_state, profile_source, profile_confirmed_at,
          profile_confirmed_by, lifecycle_state, source_epoch
        ) VALUES (
          $1::uuid, $2, 'Reply publication property', $1::text, 'Europe/Sofia', $3,
          '123', '456', 8, 'active', 'tenant_confirmed', now(),
          $4, 'active', 7
        )`,
        [property, ORGANIZATION_ID, CONNECTION_ID, managerUser],
      )
      await pool.query(
        `INSERT INTO property_access_grant (
          organization_id, property_id, user_id, source, created_by
        ) VALUES ($1, $2, $3, 'operator', $4)`,
        [ORGANIZATION_ID, property, managerUser, USER_ID],
      )
      await pool.query(
        `UPDATE capability_execution_control
            SET denied = false,
                denied_at = NULL, drained_at = NULL, cleanup_drained_at = NULL
          WHERE capability = 'property.publish_reply'`,
      )
      await pool.query(
        `INSERT INTO reviews (
          id, organization_id, property_id, platform, external_id,
          external_location_id, google_connection_id, source_epoch,
          source_revision, analysis_sequence, source_content_state
        ) VALUES (
          $1, $2, $3, 'google', $5,
          $6, $4, 7, 9, 0, 'active'
        )`,
        [
          reviewId,
          ORGANIZATION_ID,
          property,
          CONNECTION_ID,
          GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId,
          GOOGLE_LOCATION_PRIMARY_RESOURCE,
        ],
      )
      await pool.query(
        `INSERT INTO material_review_revisions (
          review_id, revision, organization_id, property_id, source_epoch,
          normalization_version, source_digest, normalized_digest, rating,
          normalized_text, content_state
        ) VALUES (
          $1, 9, $2, $3, 7, 'review-material-v1', $4, $5, 5,
          'A helpful review', 'active'
        )`,
        [reviewId, ORGANIZATION_ID, property, '1'.repeat(64), '2'.repeat(64)],
      )
      await pool.query(
        `INSERT INTO replies (
          id, review_id, organization_id, text, status, source, created_by,
          approved_by, ai_generated, authorship, state_revision, approved_at,
          publication_state, publication_cycle, publication_attempts
        ) VALUES (
          $1, $2, $3, 'Thank you for your review.', 'approved', 'internal', $4,
          $4, false, 'human', 1, now(), 'sending', 3, 2
        )`,
        [replyId, reviewId, ORGANIZATION_ID, managerUser],
      )
      await pool.query(
        `INSERT INTO reply_publication_authorizations (
          organization_id, property_id, review_id, reply_id,
          publication_cycle, source_epoch, material_review_revision,
          base_observation_revision, authorized_by_user_id,
          reply_state_revision, normalization_version, expected_reply_digest,
          authorized_at
        ) VALUES (
          $1, $2, $3, $4, 3, 7, 9, 4, $5, 1,
          'google-reply-v1', $6, now()
        )`,
        [ORGANIZATION_ID, property, reviewId, replyId, managerUser, authorizationDigest],
      )
      await pool.query(
        `INSERT INTO reply_publication_attempts (
          organization_id, property_id, review_id, reply_id,
          publication_cycle, attempt_number, provider_operation_key,
          source_epoch, material_review_revision, reply_state_revision,
          base_observation_revision, normalization_version,
          expected_reply_digest, outcome
        ) VALUES (
          $1, $2, $3, $4, 3, 2, $5, 7, 9, 1, 4,
          'google-reply-v1', $6, 'sending'
        )`,
        [
          ORGANIZATION_ID,
          property,
          reviewId,
          replyId,
          `publication:${replyId}:3:2`,
          authorizationDigest,
        ],
      )

      const connectorMembership = await pool.query(
        `SELECT member.id
           FROM google_connections AS connection
           JOIN member
             ON member."organizationId" = connection.organization_id
            AND member."userId" = connection.connected_by
          WHERE connection.id = $1`,
        [CONNECTION_ID],
      )
      expect(connectorMembership.rowCount).toBe(0)
      await expect(authority().start(await seedPublicationPermit())).resolves.toBe(
        'started',
      )

      for (const [label, overrides] of [
        ['stale cycle', { publicationCycle: 4 }],
        ['stale material revision', { materialReviewRevision: 10 }],
        ['stale digest', { expectedReplyDigest: 'd'.repeat(64) }],
        ['non-current attempt', { publicationAttemptNumber: 3 }],
        ['wrong credential generation', { credentialGeneration: 2 }],
      ] as const) {
        const snapshot = await seedPublicationPermit(overrides)
        await expect(authority().start(snapshot), label).resolves.toBe('changed')
      }

      const revokedSnapshot = await seedPublicationPermit()
      await pool.query(
        `UPDATE property_access_grant
            SET revoked_at = now(), revoke_reason = 'authority-revoked-before-send'
          WHERE organization_id = $1 AND property_id = $2 AND user_id = $3
            AND revoked_at IS NULL`,
        [ORGANIZATION_ID, property, managerUser],
      )
      await expect(authority().start(revokedSnapshot)).resolves.toBe('changed')
    } finally {
      if (permitIds.length > 0) {
        await pool.query(
          `DELETE FROM authorization_execution_permits WHERE id = ANY($1::uuid[])`,
          [permitIds],
        )
      }
      await pool.query(
        'DELETE FROM reply_publication_attempts WHERE organization_id = $1',
        [ORGANIZATION_ID],
      )
      await withPublicationAuthorizationFixtureMutation(() =>
        pool.query(
          'DELETE FROM reply_publication_authorizations WHERE organization_id = $1',
          [ORGANIZATION_ID],
        ),
      )
      await pool.query('DELETE FROM replies WHERE organization_id = $1', [
        ORGANIZATION_ID,
      ])
      await pool.query('DELETE FROM reviews WHERE organization_id = $1', [
        ORGANIZATION_ID,
      ])
      await pool.query('DELETE FROM properties WHERE id = $1', [property])
      await pool.query('DELETE FROM member WHERE id = $1', [managerMember])
      await pool.query('DELETE FROM "user" WHERE id = $1', [managerUser])
      const prior = original.rows[0]
      if (prior) {
        await pool.query(
          `UPDATE capability_execution_control
              SET denied = $1, emergency_kill_version = $2, denied_at = $3,
                  drained_at = $4, cleanup_drained_at = $5
            WHERE capability = 'property.publish_reply'`,
          [
            prior.denied,
            prior.emergency_kill_version,
            prior.denied_at,
            prior.drained_at,
            prior.cleanup_drained_at,
          ],
        )
      }
    }
  })

  it('starts PropertyManager Performance only while its Property grant is active', async () => {
    const property = randomUUID()
    const managerUser = `manager-${randomUUID()}`
    const managerMember = `member-${randomUUID()}`
    const allowedPermitId = randomUUID()
    const deniedPermitId = randomUUID()
    const original = await pool.query<NonNullable<typeof originalControl>>(
      `SELECT denied, emergency_kill_version, denied_at, drained_at, cleanup_drained_at
         FROM capability_execution_control
        WHERE capability = 'property.read_gbp_performance'`,
    )
    const seedPerformancePermit = async (permitId: string) => {
      const permission = await pool.query<{ version: string }>(
        `SELECT version FROM permission_version WHERE organization_id = $1`,
        [ORGANIZATION_ID],
      )
      const permissionVersion = permission.rows[0]?.version
      if (permissionVersion === undefined) {
        throw new Error('expected current permission version')
      }
      await pool.query(
        `INSERT INTO authorization_execution_permits (
          id, capability, organization_id, property_id, connection_id,
          initiator_user_id, operation_key, route_key, route_catalog_version,
          quota_policy_id, authorization_vector, state, admitted_at,
          start_deadline_at
        ) VALUES (
          $1, 'property.read_gbp_performance', $2, $3, $4, $5,
          'provider.performance.fetch', $6, $7, $8,
          $9::jsonb, 'admitted', $10, $11
        )`,
        [
          permitId,
          ORGANIZATION_ID,
          property,
          CONNECTION_ID,
          managerUser,
          compiledPerformance.routeKey,
          compiledPerformance.catalogueVersion,
          compiledPerformance.admission.quotaPolicyId,
          JSON.stringify({
            executionPolicyVersion: 'beta-local-2',
            principalKind: 'user',
            role: 'PropertyManager',
            permissionVersion: Number(permissionVersion),
            permissionDigest: 'e'.repeat(64),
            connectionLifecycleVersion: 1,
            connectionAccessVersion: 1,
            credentialGeneration: 1,
            propertySourceEpoch: 7,
            propertyProfileVersion: 8,
            propertyBindingState: 'active',
            propertyLifecycleState: 'active',
            propertyProfileSource: 'tenant_confirmed',
            propertyTimezoneConfirmed: true,
            requestBindingSha256: compiledPerformance.admission.requestBindingSha256,
            credentialBinding: compiledPerformance.admission.credentialBinding,
            projectFingerprint: PROJECT_FINGERPRINT,
            requestBodySha256: compiledPerformance.admission.requestBodySha256,
            requestBodyBytes: compiledPerformance.admission.requestBodyBytes,
          }),
          NOW,
          new Date(NOW.getTime() + 30_000),
        ],
      )
    }

    try {
      await pool.query(
        `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         VALUES ($1, 'Performance Manager', $2, true, now(), now())`,
        [managerUser, `${managerUser}@example.com`],
      )
      await pool.query(
        `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
         VALUES ($1, $2, $3, 'admin', now())`,
        [managerMember, managerUser, ORGANIZATION_ID],
      )
      await pool.query(
        `INSERT INTO properties (
          id, organization_id, name, slug, timezone, google_connection_id,
          gbp_account_id, gbp_location_id, profile_version,
          google_binding_state, profile_source, profile_confirmed_at,
          profile_confirmed_by, lifecycle_state, source_epoch
        ) VALUES (
          $1::uuid, $2, 'Performance property', $1::text, 'Europe/Sofia', $3,
          '123', '456', 8, 'active', 'tenant_confirmed', now(),
          $4, 'active', 7
        )`,
        [property, ORGANIZATION_ID, CONNECTION_ID, managerUser],
      )
      const grant = await pool.query<{ id: string }>(
        `INSERT INTO property_access_grant (
          organization_id, property_id, user_id, source, created_by
        ) VALUES ($1, $2, $3, 'operator', 'test') RETURNING id`,
        [ORGANIZATION_ID, property, managerUser],
      )
      await pool.query(
        `UPDATE capability_execution_control
            SET denied = false,
                denied_at = NULL, drained_at = NULL, cleanup_drained_at = NULL
          WHERE capability = 'property.read_gbp_performance'`,
      )

      await seedPerformancePermit(allowedPermitId)
      const allowed = await authority().load(allowedPermitId)
      if (!allowed) throw new Error('expected Performance permit')
      await expect(authority().start(allowed)).resolves.toBe('started')

      await pool.query(
        `UPDATE property_access_grant SET revoked_at = now(), revoke_reason = 'test'
          WHERE id = $1`,
        [grant.rows[0]!.id],
      )
      await seedPerformancePermit(deniedPermitId)
      const denied = await authority().load(deniedPermitId)
      if (!denied) throw new Error('expected denied Performance permit')
      await expect(authority().start(denied)).resolves.toBe('changed')
    } finally {
      await pool.query(
        `DELETE FROM authorization_execution_permits WHERE id IN ($1, $2)`,
        [allowedPermitId, deniedPermitId],
      )
      await pool.query('DELETE FROM properties WHERE id = $1', [property])
      await pool.query('DELETE FROM member WHERE id = $1', [managerMember])
      await pool.query('DELETE FROM "user" WHERE id = $1', [managerUser])
      const prior = original.rows[0]
      if (prior) {
        await pool.query(
          `UPDATE capability_execution_control
              SET denied = $1, emergency_kill_version = $2, denied_at = $3,
                  drained_at = $4, cleanup_drained_at = $5
            WHERE capability = 'property.read_gbp_performance'`,
          [
            prior.denied,
            prior.emergency_kill_version,
            prior.denied_at,
            prior.drained_at,
            prior.cleanup_drained_at,
          ],
        )
      }
    }
  })

  it('commits only the started revision and its code-only provider outcome', async () => {
    const adapter = authority()
    const snapshot = await adapter.load(PERMIT_ID)
    if (!snapshot) throw new Error('expected permit snapshot')
    await expect(adapter.start(snapshot)).resolves.toBe('started')

    await adapter.complete(
      snapshot.permitId,
      snapshot.authorityRevision,
      'rate_limited',
      5_000,
    )
    const result = await pool.query(
      `SELECT state, correlation_id, completed_at IS NOT NULL AS completed
         FROM authorization_execution_permits
        WHERE id = $1`,
      [PERMIT_ID],
    )
    expect(result.rows[0]).toEqual({
      state: 'completed',
      correlation_id: 'rate_limited:retry_after_5000',
      completed: true,
    })
  })

  it('does not complete after immutable permit scope changes', async () => {
    const adapter = authority()
    const snapshot = await adapter.load(PERMIT_ID)
    if (!snapshot) throw new Error('expected permit snapshot')
    await expect(adapter.start(snapshot)).resolves.toBe('started')
    await pool.query(
      `UPDATE authorization_execution_permits
          SET operation_key = 'tampered-operation'
        WHERE id = $1`,
      [PERMIT_ID],
    )

    await expect(
      adapter.complete(snapshot.permitId, snapshot.authorityRevision, 'success', null),
    ).rejects.toThrow('changed before completion')
  })

  it('fences rather than completing after the operation deadline', async () => {
    const adapter = authority()
    const snapshot = await adapter.load(PERMIT_ID)
    if (!snapshot) throw new Error('expected permit snapshot')
    await expect(adapter.start(snapshot)).resolves.toBe('started')
    await pool.query(
      `UPDATE authorization_execution_permits
          SET started_at = now() - interval '60 seconds',
              operation_deadline_at = now() - interval '30 seconds'
        WHERE id = $1`,
      [PERMIT_ID],
    )

    await expect(
      adapter.complete(snapshot.permitId, snapshot.authorityRevision, 'success', null),
    ).rejects.toThrow('changed before completion')
    const result = await pool.query(
      `SELECT state, correlation_id
         FROM authorization_execution_permits
        WHERE id = $1`,
      [PERMIT_ID],
    )
    expect(result.rows[0]).toEqual({
      state: 'fenced',
      correlation_id: 'operation_deadline_elapsed',
    })
  })

  it('starts only a linked dispatching cleanup after ordinary work is denied', async () => {
    await pool.query('DELETE FROM authorization_execution_permits WHERE id = $1', [
      PERMIT_ID,
    ])
    await seedDispatchingCleanupPermit()
    await pool.query(
      `UPDATE capability_execution_control
          SET denied = true, denied_at = $1
        WHERE capability = 'property.import_gbp_v2'`,
      [NOW],
    )
    await pool.query(
      `UPDATE google_connections
          SET status = 'disconnecting', credential_use_state = 'cleanup_only'
        WHERE id = $1`,
      [CONNECTION_ID],
    )
    const adapter = authority()
    const snapshot = await adapter.load(CLEANUP_PERMIT_ID)
    if (!snapshot) throw new Error('expected cleanup permit snapshot')

    await expect(adapter.start(snapshot)).resolves.toBe('started')

    await pool.query(
      `UPDATE authorization_execution_permits
          SET state = 'admitted', started_at = NULL, operation_deadline_at = NULL
        WHERE id = $1`,
      [CLEANUP_PERMIT_ID],
    )
    await pool.query(
      `UPDATE credential_revoke_permits
          SET cleanup_work_permit_id = NULL
        WHERE id = $1`,
      [REVOKE_PERMIT_ID],
    )
    await expect(adapter.start(snapshot)).resolves.toBe('changed')
  })

  it('acquires one disconnect cleanup permit and reconciles a started crash without resending', async () => {
    const activatedAt = new Date()
    const cleanupDeadlineAt = new Date(activatedAt.getTime() + 60_000)
    const repository = createGoogleDisconnectRevokeRepository(getDb())
    const permission = await pool.query<{ version: string }>(
      'SELECT version FROM permission_version WHERE organization_id = $1',
      [ORGANIZATION_ID],
    )
    const permissionVersion = permission.rows[0]?.version
    if (permissionVersion === undefined) {
      throw new Error('expected permission head')
    }
    const authorization = {
      capability: 'property.import_gbp_v2' as const,
      organizationId: organizationId(ORGANIZATION_ID),
      propertyId: null,
      connectionId: googleConnectionId(CONNECTION_ID),
      initiatorUserId: USER_ID,
      expectedCredentialGeneration: 1,
      authorizationVector: Object.freeze({
        executionPolicyVersion: 'beta-local-2',
        principalKind: 'user',
        role: 'AccountAdmin',
        permissionVersion: Number(permissionVersion),
        permissionDigest: 'd'.repeat(64),
        connectionLifecycleVersion: 1,
        connectionAccessVersion: 1,
        credentialGeneration: 1,
      }),
      disconnectRevoke: Object.freeze({
        attemptId: DISCONNECT_ATTEMPT_ID,
        cleanupDeadlineAtMs: cleanupDeadlineAt.getTime(),
      }),
    }
    await expect(
      repository.prepare({
        attemptId: DISCONNECT_ATTEMPT_ID,
        authorization,
        credentialBinding: compiledCleanup.admission.credentialBinding,
        cleanupDeadlineAt,
        now: activatedAt,
      }),
    ).resolves.toMatchObject({ ok: true })
    await pool.query('DELETE FROM authorization_execution_permits WHERE id = $1', [
      PERMIT_ID,
    ])
    await pool.query(
      `INSERT INTO authorization_execution_permits (
        id, capability, organization_id, connection_id, initiator_user_id,
        operation_key, route_key, route_catalog_version, quota_policy_id,
        authorization_vector, state, admitted_at, start_deadline_at
      ) VALUES (
        $1, 'property.import_gbp_v2', $2, $3, $4,
        'provider.oauth.revoke', 'oauth.revoke', $5, $6,
        $7::jsonb, 'admitted', $8, $9
      )`,
      [
        DISCONNECT_PERMIT_ID,
        ORGANIZATION_ID,
        CONNECTION_ID,
        USER_ID,
        compiledCleanup.catalogueVersion,
        compiledCleanup.admission.quotaPolicyId,
        JSON.stringify({
          ...authorization.authorizationVector,
          requestBindingSha256: compiledCleanup.admission.requestBindingSha256,
          credentialBinding: compiledCleanup.admission.credentialBinding,
          projectFingerprint: PROJECT_FINGERPRINT,
          requestBodySha256: compiledCleanup.admission.requestBodySha256,
          requestBodyBytes: compiledCleanup.admission.requestBodyBytes,
        }),
        activatedAt,
        new Date(activatedAt.getTime() + 30_000),
      ],
    )

    const acquisitions = await Promise.all([
      repository.acquireDispatch({
        attemptId: DISCONNECT_ATTEMPT_ID,
        cleanupWorkPermitId: DISCONNECT_PERMIT_ID,
        authorization,
        credentialBinding: compiledCleanup.admission.credentialBinding,
        now: activatedAt,
      }),
      repository.acquireDispatch({
        attemptId: DISCONNECT_ATTEMPT_ID,
        cleanupWorkPermitId: DISCONNECT_PERMIT_ID,
        authorization,
        credentialBinding: compiledCleanup.admission.credentialBinding,
        now: activatedAt,
      }),
    ])
    expect(acquisitions.filter((result) => result.ok)).toHaveLength(1)
    expect(acquisitions.filter((result) => !result.ok)).toHaveLength(1)

    const snapshot = await authority().load(DISCONNECT_PERMIT_ID)
    if (!snapshot) throw new Error('expected disconnect permit')
    const starts = await Promise.all([
      authority().start(snapshot),
      authority().start(snapshot),
    ])
    expect(starts.sort()).toEqual(['changed', 'started'])
    await pool.query(
      `UPDATE authorization_execution_permits
          SET state = 'fenced', fenced_at = $2,
              correlation_id = 'operation_deadline_elapsed'
        WHERE id = $1`,
      [DISCONNECT_PERMIT_ID, cleanupDeadlineAt],
    )

    await expect(
      repository.reconcileElapsed({
        now: new Date(cleanupDeadlineAt.getTime() + 1),
        limit: 10,
      }),
    ).resolves.toEqual({
      visited: 1,
      confirmedNotSent: 0,
      cleanupAmbiguous: 1,
    })
    const result = await pool.query(
      `SELECT connection.status, connection.credential_use_state,
              connection.google_subject, connection.encrypted_refresh_token,
              attempt.state, attempt.credential_binding
         FROM google_connections AS connection
         JOIN google_disconnect_revoke_attempts AS attempt
           ON attempt.organization_id = connection.organization_id
          AND attempt.connection_id = connection.id
        WHERE attempt.id = $1`,
      [DISCONNECT_ATTEMPT_ID],
    )
    expect(result.rows[0]).toEqual({
      status: 'disconnected',
      credential_use_state: 'none',
      google_subject: null,
      encrypted_refresh_token: 'redacted',
      state: 'cleanup_ambiguous',
      credential_binding: null,
    })
  })
})
