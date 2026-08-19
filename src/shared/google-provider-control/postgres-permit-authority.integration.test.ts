import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { compileGoogleProviderRequest } from './route-catalogue'
import { createPostgresGoogleAdmissionPermitAuthority } from '../../../services/google-execution-admission/postgres-permit-authority'

const ORGANIZATION_ID = 'org-google-admission-authority-test'
const CONNECTION_ID = '8e000000-0000-4000-8000-000000000001'
const APPROVAL_ID = '8a000000-0000-4000-8000-000000000001'
const PERMIT_ID = '8d000000-0000-4000-8000-000000000001'
const NOW = new Date('2026-08-12T10:00:00.000Z')
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
const vector = Object.freeze({
  executionPolicyVersion: 'beta-local-2',
  googleContentPolicyVersion: 1,
  emergencyKillVersion: 0,
  role: 'owner',
  permissionDigest: 'd'.repeat(64),
  requestBindingSha256: compiled.admission.requestBindingSha256,
  credentialBinding: compiled.admission.credentialBinding,
  projectFingerprint: PROJECT_FINGERPRINT,
  requestBodySha256: compiled.admission.requestBodySha256,
  requestBodyBytes: compiled.admission.requestBodyBytes,
})

let pool: Pool

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
        'release', 'manifest', 'index', 'deployment', 'adr',
        'google-content-live-1', 'google-oauth-oidc-1', 'project', 'client',
        'redirect', 'origins', 'google-content-egress-1', 'runtime',
        '2026-08-05', '2026-08-16', 'beta-local-2', 'beta-local-2',
        '0032_property-operation-receipts-expand', '{}'::jsonb, '{}'::jsonb,
        '{}'::jsonb, $2, $3, 'approved'
      ) ON CONFLICT (id) DO NOTHING`,
      [APPROVAL_ID, NOW, new Date(NOW.getTime() + 24 * 60 * 60_000)],
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
  await pool.query(
    `INSERT INTO authorization_execution_permits (
      id, capability, organization_id, connection_id, initiator_user_id,
      operation_key, route_key, route_catalog_version, quota_policy_id,
      policy_version, emergency_kill_version, approval_binding_id,
      permit_generation, start_vector_mode, commit_vector_mode,
      authorization_vector, state, admitted_at, start_deadline_at
    ) VALUES (
      $1, 'property.import_gbp_v2', $2, $3, 'user-admission-test',
      'account-discovery', $4, $5, $6, 1, 0, $7, 1, 'full', 'full',
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
      JSON.stringify(vector),
      NOW,
      new Date(NOW.getTime() + 30_000),
    ],
  )
}

function authority() {
  return createPostgresGoogleAdmissionPermitAuthority({
    pool,
    now: () => NOW,
    gatewayIdentity: 'google-egress-gateway-1',
  })
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL })
  await seedApproval()
})

beforeEach(async () => {
  await pool.query(
    'DELETE FROM authorization_execution_permits WHERE organization_id = $1',
    [ORGANIZATION_ID],
  )
  await seedPermit()
})

afterAll(async () => {
  await pool.query(
    'DELETE FROM authorization_execution_permits WHERE organization_id = $1',
    [ORGANIZATION_ID],
  )
  await pool.end()
})

describe('Postgres Google admission permit authority', () => {
  it('loads persisted scope dimensions and starts exactly one permit generation', async () => {
    const adapter = authority()
    const snapshot = await adapter.load(PERMIT_ID)
    if (!snapshot) throw new Error('expected permit snapshot')

    expect(snapshot.quotaKey).toMatchObject({
      organizationId: ORGANIZATION_ID,
      initiatorUserId: 'user-admission-test',
      connectionId: CONNECTION_ID,
      propertyId: null,
      endpointClass: 'account-management',
    })
    await expect(adapter.start(snapshot)).resolves.toBe('started')
    await expect(adapter.start(snapshot)).resolves.toBe('changed')
    const result = await pool.query(
      'SELECT state FROM authorization_execution_permits WHERE id = $1',
      [PERMIT_ID],
    )
    expect(result.rows[0]?.state).toBe('started')
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
})
