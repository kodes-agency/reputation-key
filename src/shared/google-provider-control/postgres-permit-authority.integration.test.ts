import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { getEnv } from '#/shared/config/env'
import { withLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { compileGoogleProviderRequest } from './route-catalogue'
import { createPostgresGoogleAdmissionPermitAuthority } from '../../../services/google-execution-admission/postgres-permit-authority'

const ORGANIZATION_ID = 'org-google-admission-authority-test'
const USER_ID = 'user-google-admission-authority-test'
const MEMBER_ID = 'member-google-admission-authority-test'
const CONNECTION_ID = '8e000000-0000-4000-8000-000000000001'
const APPROVAL_ID = randomUUID()
const PERMIT_ID = '8d000000-0000-4000-8000-000000000001'
const CLEANUP_PERMIT_ID = '8d000000-0000-4000-8000-000000000002'
const SOURCE_WORK_PERMIT_ID = '8d000000-0000-4000-8000-000000000003'
const SOURCE_OPERATION_ID = '8d000000-0000-4000-8000-000000000004'
const REVOKE_PERMIT_ID = '8d000000-0000-4000-8000-000000000005'
const SUBJECT_GUARD_ID = '8d000000-0000-4000-8000-000000000006'
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
const vector = Object.freeze({
  executionPolicyVersion: 'beta-local-2',
  googleContentPolicyVersion: 0,
  emergencyKillVersion: 0,
  role: 'AccountAdmin',
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

async function seedApproval(): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      'property.import_gbp_v2:local_sandbox:sandbox',
    ])
    await client.query(
      `INSERT INTO capability_compliance_approvals (
        id, binding_version, capability, target_phase, environment_profile,
        release_sha, evidence_manifest_sha256, evidence_index_sha256,
        deployment_attestation_sha256, adr_0050_sha256,
        google_content_policy_version, google_oauth_contract_version,
        google_project_attestation_sha256, google_oauth_client_id_sha256,
        google_redirect_uri_sha256, provider_origin_profile_sha256,
        runtime_isolation_profile_version, runtime_isolation_profile_sha256,
        performance_catalog_version, route_catalog_version,
        capability_policy_version,
        execution_policy_version, migration_head, evidence_index, image_digests,
        role_approvals, approved_at, expires_at, status
      ) VALUES (
        $1, (
          SELECT COALESCE(MAX(binding_version), 0) + 1
          FROM capability_compliance_approvals
          WHERE capability = 'property.import_gbp_v2'
            AND target_phase = 'local_sandbox'
            AND environment_profile = 'sandbox'
        ), 'property.import_gbp_v2', 'local_sandbox', 'sandbox',
        $4, 'manifest', 'index', 'deployment', 'adr',
        'google-content-live-1', 'google-oauth-oidc-1', $5, 'client',
        'redirect', 'origins', 'google-content-egress-1', 'runtime',
        '2026-08-05', '2026-08-16', 'beta-local-2', 'beta-local-2',
        '0032_property-operation-receipts-expand', '{}'::jsonb, '{}'::jsonb,
        '{}'::jsonb, $2, $3, 'approved'
      ) ON CONFLICT (id) DO NOTHING`,
      [
        APPROVAL_ID,
        NOW,
        new Date(NOW.getTime() + 24 * 60 * 60_000),
        RELEASE_SHA,
        PROJECT_FINGERPRINT,
      ],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function seedPermit(): Promise<void> {
  const policy = await pool.query<{
    version: string
    emergency_kill_version: string
  }>(
    `SELECT version, emergency_kill_version
       FROM policy_version WHERE scope = 'global'`,
  )
  const current = policy.rows[0]
  if (!current) throw new Error('expected global policy head')
  await pool.query(
    `INSERT INTO authorization_execution_permits (
      id, capability, organization_id, connection_id, initiator_user_id,
      operation_key, route_key, route_catalog_version, quota_policy_id,
      policy_version, emergency_kill_version, approval_binding_id,
      permit_generation, start_vector_mode, commit_vector_mode,
      authorization_vector, state, admitted_at, start_deadline_at
    ) VALUES (
      $1, 'property.import_gbp_v2', $2, $3, $11,
      'account-discovery', $4, $5, $6,
      (SELECT version FROM policy_version WHERE scope = 'global'),
      (SELECT emergency_kill_version FROM policy_version WHERE scope = 'global'),
      $7, 1, 'full', 'full',
      $8::jsonb, 'admitted', $9, $10
    )`,
    [
      PERMIT_ID,
      ORGANIZATION_ID,
      CONNECTION_ID,
      compiled.routeKey,
      compiled.catalogueVersion,
      compiled.admission.quotaPolicyId,
      APPROVAL_ID,
      JSON.stringify({
        ...vector,
        googleContentPolicyVersion: Number(current.version),
        emergencyKillVersion: Number(current.emergency_kill_version),
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
  const policy = await pool.query<{
    version: string
    emergency_kill_version: string
  }>("SELECT version, emergency_kill_version FROM policy_version WHERE scope = 'global'")
  const current = policy.rows[0]
  if (!current) throw new Error('expected global policy head')
  const cleanupVector = {
    ...vector,
    googleContentPolicyVersion: Number(current.version),
    emergencyKillVersion: Number(current.emergency_kill_version),
    requestBindingSha256: compiledCleanup.admission.requestBindingSha256,
    credentialBinding: compiledCleanup.admission.credentialBinding,
    requestBodySha256: compiledCleanup.admission.requestBodySha256,
    requestBodyBytes: compiledCleanup.admission.requestBodyBytes,
  }
  await pool.query(
    `INSERT INTO authorization_execution_permits (
      id, capability, organization_id, connection_id, initiator_user_id,
      operation_key, route_key, route_catalog_version, quota_policy_id,
      policy_version, emergency_kill_version, approval_binding_id,
      permit_generation, start_vector_mode, commit_vector_mode,
      authorization_vector, state, admitted_at, start_deadline_at,
      started_at, operation_deadline_at, completed_at
    ) VALUES (
      $1, 'property.import_gbp_v2', $2, $3, $4,
      'provider.oauth.token.refresh', 'oauth.token.refresh', $5, 'google-credential-refresh-v1',
      $6, $7, $8, 1, 'full', 'full', $9::jsonb,
      'completed', $10, $11, $10, $11, $10
    )`,
    [
      SOURCE_WORK_PERMIT_ID,
      ORGANIZATION_ID,
      CONNECTION_ID,
      USER_ID,
      compiledCleanup.catalogueVersion,
      current.version,
      current.emergency_kill_version,
      APPROVAL_ID,
      JSON.stringify(vector),
      new Date(NOW.getTime() - 2_000),
      new Date(NOW.getTime() + 60_000),
    ],
  )
  await pool.query(
    `INSERT INTO authorization_execution_permits (
      id, capability, organization_id, connection_id, initiator_user_id,
      operation_key, route_key, route_catalog_version, quota_policy_id,
      policy_version, emergency_kill_version, approval_binding_id,
      permit_generation, start_vector_mode, commit_vector_mode,
      authorization_vector, state, admitted_at, start_deadline_at
    ) VALUES (
      $1, 'property.import_gbp_v2', $2, $3, $4,
      'provider.oauth.revoke', $5, $6, $7,
      $8, $9, $10, 2, 'full', 'full', $11::jsonb,
      'admitted', $12, $13
    )`,
    [
      CLEANUP_PERMIT_ID,
      ORGANIZATION_ID,
      CONNECTION_ID,
      USER_ID,
      compiledCleanup.routeKey,
      compiledCleanup.catalogueVersion,
      compiledCleanup.admission.quotaPolicyId,
      current.version,
      current.emergency_kill_version,
      APPROVAL_ID,
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
    gatewayIdentity: 'google-egress-gateway-1',
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
    `INSERT INTO organization_capability (organization_id, capability)
     VALUES ($1, 'property.import_gbp_v2')
     ON CONFLICT DO NOTHING`,
    [ORGANIZATION_ID],
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
    [CONNECTION_ID, ORGANIZATION_ID, USER_ID],
  )
  const control = await pool.query<NonNullable<typeof originalControl>>(
    `SELECT denied, emergency_kill_version, denied_at, drained_at, cleanup_drained_at
       FROM capability_execution_control
      WHERE capability = 'property.import_gbp_v2'`,
  )
  originalControl = control.rows[0]
  await seedApproval()
})

beforeEach(async () => {
  await clearCredentialLifecycle()
  await pool.query(
    `INSERT INTO organization_capability (organization_id, capability)
     VALUES ($1, 'property.import_gbp_v2')
     ON CONFLICT DO NOTHING`,
    [ORGANIZATION_ID],
  )
  await pool.query(
    `UPDATE capability_execution_control
        SET denied = false,
            emergency_kill_version = (
              SELECT emergency_kill_version FROM policy_version WHERE scope = 'global'
            ),
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
  await pool.query('DELETE FROM organization_capability WHERE organization_id = $1', [
    ORGANIZATION_ID,
  ])
  await withLastOwnerGuardDisabled(pool, async (client) => {
    await client.query('DELETE FROM member WHERE id = $1', [MEMBER_ID])
    await client.query('DELETE FROM "user" WHERE id = $1', [USER_ID])
    await client.query('DELETE FROM organization WHERE id = $1', [ORGANIZATION_ID])
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
      `SELECT outcome FROM start_google_execution_permit_v1(
        $1::uuid, $2::bigint, $3::bigint, $4::bigint,
        $5::text, $6::text, $7::text, '{}'::jsonb, $8::text
      )`,
      [
        snapshot.permitId,
        snapshot.permitGeneration,
        snapshot.policyVersion,
        snapshot.emergencyKillVersion,
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

  it('fences a permit when the live capability control is denied after load', async () => {
    const adapter = authority()
    const snapshot = await adapter.load(PERMIT_ID)
    if (!snapshot) throw new Error('expected permit snapshot')
    await pool.query(
      `UPDATE capability_execution_control
          SET denied = true, denied_at = $1
        WHERE capability = 'property.import_gbp_v2'`,
      [NOW],
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

  it('fences a permit when its live organization capability is revoked after load', async () => {
    const adapter = authority()
    const snapshot = await adapter.load(PERMIT_ID)
    if (!snapshot) throw new Error('expected permit snapshot')
    await pool.query(
      `DELETE FROM organization_capability
        WHERE organization_id = $1 AND capability = 'property.import_gbp_v2'`,
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

  it('does not fence a newer generation through stale failure cleanup', async () => {
    const adapter = authority()
    const snapshot = await adapter.load(PERMIT_ID)
    if (!snapshot) throw new Error('expected permit snapshot')
    await expect(adapter.start(snapshot)).resolves.toBe('started')
    await pool.query(
      `UPDATE authorization_execution_permits
          SET permit_generation = permit_generation + 1
        WHERE id = $1`,
      [PERMIT_ID],
    )

    await adapter.failStarted(snapshot, 'grant_unavailable')
    const result = await pool.query(
      `SELECT state, permit_generation
         FROM authorization_execution_permits
        WHERE id = $1`,
      [PERMIT_ID],
    )
    expect(result.rows[0]).toMatchObject({ state: 'started', permit_generation: '2' })
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
})
