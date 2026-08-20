import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { createCredentialLifecycleRepository } from './credential-lifecycle.repository'

const ORG_ID = 'org-credential-lifecycle-test'
const CONNECTION_ID = '9e000000-0000-4000-8000-000000000001'
const APPROVAL_ID = '9a000000-0000-4000-8000-000000000001'
const PERMIT_ID = '9d000000-0000-4000-8000-000000000001'
const SOURCE_ID = '9b000000-0000-4000-8000-000000000001'
const REVOKE_ID = '9c000000-0000-4000-8000-000000000001'
const NOW = new Date('2026-08-10T12:00:00.000Z')
const OPERATION_DEADLINE = new Date('2026-08-10T12:00:30.000Z')
const CLEANUP_DEADLINE = new Date('2026-08-10T12:05:00.000Z')
const HMAC = 'a'.repeat(43)
const GUARD_KEY = {
  projectClientHmacKeyVersion: 'v1',
  projectClientHmac: 'p'.repeat(43),
  subjectHmacKeyVersion: 'v1',
  subjectHmac: 's'.repeat(43),
} as const

let pool: Pool
const db = getDb()
const repository = createCredentialLifecycleRepository(db)

async function clearRows(): Promise<void> {
  await pool.query(
    `DELETE FROM credential_revoke_permits
      WHERE source_operation_id IN (
        SELECT id FROM google_credential_source_operations WHERE organization_id = $1
      )`,
    [ORG_ID],
  )
  await pool.query(
    'DELETE FROM google_credential_source_operations WHERE organization_id = $1',
    [ORG_ID],
  )
  await pool.query(
    'DELETE FROM google_subject_authority_guards WHERE project_client_hmac = $1',
    [GUARD_KEY.projectClientHmac],
  )
  await pool.query(
    'DELETE FROM authorization_execution_permits WHERE organization_id = $1',
    [ORG_ID],
  )
}

async function seedStartedPermit(
  permitId = PERMIT_ID,
  vector: Record<string, number> = {
    expectedConnectionLifecycleVersion: 3,
    expectedConnectionAccessVersion: 4,
    expectedCredentialGeneration: 5,
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO capability_compliance_approvals (
      id, binding_version, capability, target_phase, environment_profile,
      release_sha, evidence_manifest_sha256, evidence_index_sha256,
      deployment_attestation_sha256, adr_0050_sha256,
      google_content_policy_version, google_oauth_contract_version,
      google_project_attestation_sha256, google_oauth_client_id_sha256,
      google_redirect_uri_sha256, provider_origin_profile_sha256,
      runtime_isolation_profile_version, runtime_isolation_profile_sha256,
      performance_catalog_version, route_catalog_version, capability_policy_version,
      execution_policy_version, migration_head, evidence_index, image_digests,
      role_approvals, approved_at, expires_at, status
    ) VALUES (
      $1, 701, 'property.import_gbp_v2', 'local_sandbox', 'sandbox',
      'release', 'manifest', 'index', 'deployment', 'adr',
      '2026-08-05', 'google-oauth-oidc-1', 'project', 'client', 'redirect',
      'origins', 'google-content-egress-1', 'runtime', '2026-08-05', '2026-08-16',
      'beta-local-2', 'beta-local-2', '0030_giant_hellfire_club',
      '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, $2, $3, 'approved'
    ) ON CONFLICT (id) DO NOTHING`,
    [APPROVAL_ID, NOW, CLEANUP_DEADLINE],
  )
  await pool.query(
    `INSERT INTO authorization_execution_permits (
      id, capability, organization_id, connection_id, operation_key,
      route_key, route_catalog_version, quota_policy_id, policy_version,
      emergency_kill_version, approval_binding_id, permit_generation,
      start_vector_mode, commit_vector_mode, authorization_vector, state,
      admitted_at, start_deadline_at, started_at, operation_deadline_at
    ) VALUES (
      $1, 'property.import_gbp_v2', $2, $3, 'credential-refresh',
      'google.oauth.token', 'google-provider-routes-1', 'oauth-refresh', 1,
      1, $4, 1, 'full', 'core_credential_projection', $5::jsonb, 'started',
      $6, $7, $6, $8
    )`,
    [
      permitId,
      ORG_ID,
      CONNECTION_ID,
      APPROVAL_ID,
      JSON.stringify(vector),
      NOW,
      new Date(NOW.getTime() + 1_000),
      OPERATION_DEADLINE,
    ],
  )
}

function registration(
  overrides: Partial<Parameters<typeof repository.registerSource>[0]> = {},
): Parameters<typeof repository.registerSource>[0] {
  return {
    sourceOperationId: SOURCE_ID,
    revokePermitId: REVOKE_ID,
    sourceWorkPermitId: PERMIT_ID,
    organizationId: ORG_ID,
    connectionId: CONNECTION_ID,
    guardKey: GUARD_KEY,
    kind: 'refresh',
    expectedLifecycleVersion: 3,
    expectedAccessVersion: 4,
    expectedCredentialGeneration: 5,
    cleanupDeadlineAt: CLEANUP_DEADLINE,
    now: NOW,
    ...overrides,
  }
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL })
})

beforeEach(clearRows)
afterAll(async () => {
  await clearRows()
  await pool.end()
})

describe('credential lifecycle repository', () => {
  it('serializes source work and consumes exact-token cleanup authorization once', async () => {
    await seedStartedPermit()
    await expect(repository.registerSource(registration())).resolves.toMatchObject({
      ok: true,
      value: { sequence: 1 },
    })

    const secondPermitId = '9d000000-0000-4000-8000-000000000002'
    await seedStartedPermit(secondPermitId)
    await expect(
      repository.registerSource(
        registration({
          sourceOperationId: '9b000000-0000-4000-8000-000000000002',
          revokePermitId: '9c000000-0000-4000-8000-000000000002',
          sourceWorkPermitId: secondPermitId,
        }),
      ),
    ).resolves.toEqual({ ok: false, code: 'concurrent_operation' })

    await expect(
      repository.markProviderStarted({
        organizationId: ORG_ID,
        sourceOperationId: SOURCE_ID,
        now: new Date(NOW.getTime() + 1_000),
      }),
    ).resolves.toMatchObject({ ok: true, value: { sequence: 1 } })
    await expect(
      repository.activateCleanup({
        organizationId: ORG_ID,
        sourceOperationId: SOURCE_ID,
        tokenHmacKeyVersion: 'v1',
        tokenHmac: HMAC,
        sendAuthorizationExpiresAt: new Date(NOW.getTime() + 20_000),
        outcomeCode: 'rotated_credential_committed',
        now: new Date(NOW.getTime() + 2_000),
      }),
    ).resolves.toMatchObject({ ok: true, value: { revokePermitId: REVOKE_ID } })

    await expect(
      repository.acquireCleanupDispatch({
        organizationId: ORG_ID,
        revokePermitId: REVOKE_ID,
        tokenHmacKeyVersion: 'v1',
        tokenHmac: 'z'.repeat(43),
        now: new Date(NOW.getTime() + 3_000),
      }),
    ).resolves.toEqual({ ok: false, code: 'token_mismatch' })
    await expect(
      repository.acquireCleanupDispatch({
        organizationId: ORG_ID,
        revokePermitId: REVOKE_ID,
        tokenHmacKeyVersion: 'v1',
        tokenHmac: HMAC,
        now: new Date(NOW.getTime() + 3_000),
      }),
    ).resolves.toMatchObject({ ok: true, value: { sourceOperationId: SOURCE_ID } })

    const dispatching = await pool.query(
      'SELECT state, token_hmac, send_authorization_expires_at FROM credential_revoke_permits WHERE id = $1',
      [REVOKE_ID],
    )
    expect(dispatching.rows[0]).toEqual({
      state: 'dispatching',
      token_hmac: null,
      send_authorization_expires_at: null,
    })

    await expect(
      repository.finishCleanup({
        organizationId: ORG_ID,
        revokePermitId: REVOKE_ID,
        outcome: 'confirmed_revoked',
        outcomeCode: 'google_revoked',
        now: new Date(NOW.getTime() + 4_000),
      }),
    ).resolves.toMatchObject({ ok: true, value: { sourceOperationId: SOURCE_ID } })
    const terminal = await pool.query(
      `SELECT r.state AS revoke_state, s.state AS source_state, g.state AS guard_state
       FROM credential_revoke_permits r
       JOIN google_credential_source_operations s ON s.id = r.source_operation_id
       JOIN google_subject_authority_guards g ON g.id = r.guard_id
       WHERE r.id = $1`,
      [REVOKE_ID],
    )
    expect(terminal.rows[0]).toEqual({
      revoke_state: 'confirmed_revoked',
      source_state: 'terminal',
      guard_state: 'open',
    })

    const nextPermitId = '9d000000-0000-4000-8000-000000000003'
    await seedStartedPermit(nextPermitId)
    await expect(
      repository.registerSource(
        registration({
          sourceOperationId: '9b000000-0000-4000-8000-000000000002',
          revokePermitId: '9c000000-0000-4000-8000-000000000002',
          sourceWorkPermitId: nextPermitId,
        }),
      ),
    ).resolves.toMatchObject({ ok: true, value: { sequence: 2 } })
  })

  it('records a pre-dispatch denial and erases token authorization atomically', async () => {
    await seedStartedPermit()
    await repository.registerSource(registration())
    await repository.markProviderStarted({
      organizationId: ORG_ID,
      sourceOperationId: SOURCE_ID,
      now: new Date(NOW.getTime() + 1_000),
    })
    await repository.activateCleanup({
      organizationId: ORG_ID,
      sourceOperationId: SOURCE_ID,
      tokenHmacKeyVersion: 'v1',
      tokenHmac: HMAC,
      sendAuthorizationExpiresAt: new Date(NOW.getTime() + 20_000),
      outcomeCode: 'rotated_credential_rejected',
      now: new Date(NOW.getTime() + 2_000),
    })
    await expect(
      repository.finishCleanupWithoutDispatch({
        organizationId: ORG_ID,
        revokePermitId: REVOKE_ID,
        outcomeCode: 'cleanup_admission_denied',
        now: new Date(NOW.getTime() + 3_000),
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { sourceOperationId: SOURCE_ID },
    })
    const rows = await pool.query(
      `SELECT r.state, r.token_hmac, r.send_authorization_expires_at,
              g.state AS guard_state
         FROM credential_revoke_permits r
         JOIN google_subject_authority_guards g ON g.id = r.guard_id
        WHERE r.id = $1`,
      [REVOKE_ID],
    )
    expect(rows.rows[0]).toEqual({
      state: 'confirmed_not_sent',
      token_hmac: null,
      send_authorization_expires_at: null,
      guard_state: 'provider_reset_required',
    })

    const nextPermitId = '9d000000-0000-4000-8000-000000000002'
    await seedStartedPermit(nextPermitId)
    await expect(
      repository.registerSource(
        registration({
          sourceOperationId: '9b000000-0000-4000-8000-000000000002',
          revokePermitId: '9c000000-0000-4000-8000-000000000002',
          sourceWorkPermitId: nextPermitId,
        }),
      ),
    ).resolves.toEqual({ ok: false, code: 'concurrent_operation' })
  })

  it('expires unconsumed token authorization and its HMAC atomically', async () => {
    await seedStartedPermit()
    await repository.registerSource(registration())
    await repository.markProviderStarted({
      organizationId: ORG_ID,
      sourceOperationId: SOURCE_ID,
      now: new Date(NOW.getTime() + 1_000),
    })
    await repository.activateCleanup({
      organizationId: ORG_ID,
      sourceOperationId: SOURCE_ID,
      tokenHmacKeyVersion: 'v1',
      tokenHmac: HMAC,
      sendAuthorizationExpiresAt: new Date(NOW.getTime() + 20_000),
      outcomeCode: 'rotated_credential_committed',
      now: new Date(NOW.getTime() + 2_000),
    })

    await expect(
      repository.expireDeadlines({
        now: new Date(NOW.getTime() + 20_000),
        limit: 100,
      }),
    ).resolves.toEqual({ expired: 1 })
    const rows = await pool.query(
      `SELECT r.state, r.token_hmac, r.send_authorization_expires_at,
              g.state AS guard_state
       FROM credential_revoke_permits r
       JOIN google_subject_authority_guards g ON g.id = r.guard_id
       WHERE r.id = $1`,
      [REVOKE_ID],
    )
    expect(rows.rows[0]).toEqual({
      state: 'confirmed_not_sent',
      token_hmac: null,
      send_authorization_expires_at: null,
      guard_state: 'provider_reset_required',
    })
  })

  it('expires a source that never reached the provider without requiring cleanup', async () => {
    await seedStartedPermit()
    await repository.registerSource(registration())

    await expect(
      repository.expireDeadlines({
        now: CLEANUP_DEADLINE,
        limit: 100,
      }),
    ).resolves.toEqual({ expired: 1 })
    const rows = await pool.query(
      `SELECT r.state AS revoke_state, s.state AS source_state, g.state AS guard_state
       FROM credential_revoke_permits r
       JOIN google_credential_source_operations s ON s.id = r.source_operation_id
       JOIN google_subject_authority_guards g ON g.id = r.guard_id
       WHERE r.id = $1`,
      [REVOKE_ID],
    )
    expect(rows.rows[0]).toEqual({
      revoke_state: 'consumed_no_revoke',
      source_state: 'terminal',
      guard_state: 'open',
    })
  })

  it('derives the source deadline and version vector from the started permit', async () => {
    await seedStartedPermit(PERMIT_ID, {
      expectedConnectionLifecycleVersion: 99,
      expectedConnectionAccessVersion: 4,
      expectedCredentialGeneration: 5,
    })
    await expect(repository.registerSource(registration())).resolves.toEqual({
      ok: false,
      code: 'scope_mismatch',
    })
    const rows = await pool.query(
      'SELECT id FROM google_credential_source_operations WHERE organization_id = $1',
      [ORG_ID],
    )
    expect(rows.rows).toHaveLength(0)
  })
})
