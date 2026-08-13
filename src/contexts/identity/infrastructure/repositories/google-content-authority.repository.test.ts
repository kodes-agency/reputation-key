import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import {
  GOOGLE_CONTENT_APPROVAL_ROLES,
  type GoogleContentApprovalBinding,
  type GoogleContentApprovalRoleDocument,
} from '#/shared/auth/google-content-contract'
import {
  canonicalGoogleContentSha256,
  type GoogleContentApprovalCandidate,
} from '#/shared/auth/google-content-approval'
import {
  createGoogleContentAuthorizationAuthority,
  type GoogleContentRuntimeBinding,
} from '#/shared/auth/google-content-authority'
import { createGoogleContentAuthorityRepository } from './google-content-authority.repository'
import { closePool } from '#/shared/db/pool'

const db = getDb()
const now = new Date('2026-08-10T10:00:00.000Z')

const bindingBase = (): Omit<GoogleContentApprovalBinding, 'evidenceIndexSha256'> => ({
  capability: 'property.import_gbp_v2',
  targetPhase: 'local_sandbox',
  environmentProfile: 'sandbox',
  releaseSha: 'release-sha',
  evidenceManifestSha256: canonicalGoogleContentSha256('manifest'),
  deploymentAttestationSha256: canonicalGoogleContentSha256('deployment'),
  adr0050Sha256: canonicalGoogleContentSha256('adr-0050'),
  googleContentPolicyVersion: 'google-content-live-1',
  googleOAuthContractVersion: 'google-oauth-oidc-1',
  googleProjectAttestationSha256: canonicalGoogleContentSha256('project-attestation'),
  googleOAuthClientIdSha256: canonicalGoogleContentSha256('oauth-client-id'),
  googleRedirectUriSha256: canonicalGoogleContentSha256('redirect-uri'),
  providerOriginProfileSha256: canonicalGoogleContentSha256('provider-origin-profile'),
  runtimeIsolationProfileVersion: 'google-content-egress-1',
  runtimeIsolationProfileSha256: canonicalGoogleContentSha256(
    'runtime-isolation-profile',
  ),
  performanceCatalogVersion: '2026-08-05',
  capabilityPolicyVersion: 'beta-local-2',
  executionPolicyVersion: 'beta-local-2',
  migrationHead: '0029_google-content-control',
  imageDigests: {
    web: `sha256:${canonicalGoogleContentSha256('web-image')}`,
    worker: `sha256:${canonicalGoogleContentSha256('worker-image')}`,
    googleExecutionAdmission: `sha256:${canonicalGoogleContentSha256('admission-image')}`,
    googleEgressGateway: `sha256:${canonicalGoogleContentSha256('gateway-image')}`,
    providerEphemeralRedis: `sha256:${canonicalGoogleContentSha256('redis-image')}`,
  },
  approvedAt: now.toISOString(),
  expiresAt: '2026-08-12T10:00:00.000Z',
  status: 'approved',
})

const runtimeBinding = (): GoogleContentRuntimeBinding => {
  const {
    approvedAt: _approvedAt,
    expiresAt: _expiresAt,
    status: _status,
    ...runtime
  } = binding()
  return runtime
}

const roleDocument = (
  role: (typeof GOOGLE_CONTENT_APPROVAL_ROLES)[number],
): GoogleContentApprovalRoleDocument => ({
  role,
  capability: 'property.import_gbp_v2',
  manifestSha256: bindingBase().evidenceManifestSha256,
  releaseSha: 'release-sha',
  targetPhase: 'local_sandbox',
  environmentProfile: 'sandbox',
  transientPerformanceReportingDecision: 'approved',
  confirmedImportProfileTreatmentDecision: 'approved',
  unmanagedUserAgentMemoryResidualDecision: 'approved',
  approverIdentity: `${role}-approver`,
  approvedAt: now.toISOString(),
  expiresAt: '2026-08-12T10:00:00.000Z',
  signature: `${role}-signature`,
})

const candidate = (): GoogleContentApprovalCandidate => {
  const roleDocuments = GOOGLE_CONTENT_APPROVAL_ROLES.map((role) => {
    const document = roleDocument(role)
    return { sha256: canonicalGoogleContentSha256(document), document }
  })
  const indexDocument = {
    manifestSha256: bindingBase().evidenceManifestSha256,
    artifactSha256: { deployment: bindingBase().deploymentAttestationSha256 },
    roleDocumentSha256: {
      'engineering/runtime': roleDocuments[0]!.sha256,
      'product/property': roleDocuments[1]!.sha256,
      'security/privacy': roleDocuments[2]!.sha256,
      'google-project/integration': roleDocuments[3]!.sha256,
      'operations/on-call': roleDocuments[4]!.sha256,
    },
  }
  const index = {
    ...indexDocument,
    sha256: canonicalGoogleContentSha256(indexDocument),
  }
  return {
    binding: { ...bindingBase(), evidenceIndexSha256: index.sha256 },
    index,
    roleDocuments,
  }
}

const approvalBundle = () => ({ manifest: 'manifest', candidate: candidate() })

const binding = (): GoogleContentApprovalBinding => candidate().binding

beforeEach(async () => {
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM credential_revoke_permits`)
    await tx.execute(sql`DELETE FROM google_credential_source_operations`)
    await tx.execute(sql`DELETE FROM google_subject_authority_guards`)
    await tx.execute(sql`DELETE FROM authorization_execution_permits`)
    await tx.execute(sql`
      UPDATE capability_execution_control
      SET denied = true,
          emergency_kill_version = 1,
          denied_at = ${now},
          drained_at = NULL,
          cleanup_drained_at = NULL,
          operator_id = NULL,
          reason = 'test_reset'
    `)
    await tx.execute(sql`
      UPDATE policy_version
      SET emergency_kill_version = 1
      WHERE scope = 'global'
    `)
  })
})

afterAll(async () => {
  await closePool()
})

describe('Google Content authority repository', () => {
  it('loads the migration-seeded deny and persists immutable versioned approvals', async () => {
    const store = createGoogleContentAuthorityRepository(db)
    const before = await store.transaction((tx) => store.loadControl(tx))
    expect(before).toMatchObject({
      emergencyKillVersion: 1,
      killedCapabilities: expect.arrayContaining([
        'property.import_gbp_v2',
        'property.read_gbp_performance',
      ]),
    })

    const approval = await store.transaction((tx) =>
      store.appendApproval(tx, candidate()),
    )
    const after = await store.transaction((tx) => store.loadControl(tx))
    expect(after.policyVersion).toBe(before.policyVersion + 1)
    await expect(
      store.transaction((tx) => store.loadApprovalById(tx, approval.id)),
    ).resolves.toEqual(approval)
    await expect(
      db.execute(sql`
        UPDATE capability_compliance_approvals
        SET release_sha = 'tampered'
        WHERE id = ${approval.id}::uuid
      `),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringMatching(/capability compliance approvals are append-only/),
      }),
    })
  })

  it('atomically admits, fences, increments the kill generation, and drains', async () => {
    const store = createGoogleContentAuthorityRepository(db)

    const authority = createGoogleContentAuthorizationAuthority({
      store,
      clock: () => now,
      newPermitId: randomUUID,
      verifyRoleApproval: (document) =>
        document.signature === `${document.role}-signature`,
      refreshPolicy: () =>
        store.transaction(async (tx) => {
          const control = await store.loadControl(tx)
          return {
            version: control.policyVersion,
            emergencyKillVersion: control.emergencyKillVersion,
          }
        }),
      isRegisteredOperator: () => true,
      authorize: async () => ({
        allowed: true,
        vector: { membershipGeneration: 7, credentialGeneration: 2 },
      }),
    })
    await expect(authority.installApproval(approvalBundle())).resolves.toMatchObject({
      ok: true,
    })
    await expect(
      authority.allowCapability(runtimeBinding(), 'operator-1', 'approved rollout'),
    ).resolves.toEqual({ ok: true, emergencyKillVersion: 2 })
    const admitted = await authority.admit({
      runtimeBinding: runtimeBinding(),
      scope: {
        organizationId: 'org-1',
        propertyId: null,
        connectionId: null,
        initiatorUserId: 'user-1',
      },
      operationKey: 'import.start',
      routeKey: 'google.business-information.locations.list',
      routeCatalogVersion: 'google-provider-routes-1',
      quotaPolicyId: 'gbp-business-information-interactive-1',
      providerRequestBinding: {
        requestBindingSha256: 'a'.repeat(64),
        credentialBinding: 'b'.repeat(64),
        projectFingerprint: 'c'.repeat(64),
        requestBodySha256: null,
        requestBodyBytes: 0,
      },
      startVectorMode: 'full',
      commitVectorMode: 'full',
    })
    expect(admitted).toMatchObject({ ok: true, permit: { state: 'admitted' } })

    await expect(
      authority.denyCapability('property.import_gbp_v2', 'operator-1', 'incident'),
    ).resolves.toEqual({ ok: true, emergencyKillVersion: 3, drained: true })

    const rows = await db.execute(sql`
      SELECT p.state, c.denied, c.drained_at, c.cleanup_drained_at
      FROM authorization_execution_permits p
      JOIN capability_execution_control c ON c.capability = p.capability
      WHERE p.capability = 'property.import_gbp_v2'
    `)
    expect(rows.rows).toEqual([
      expect.objectContaining({
        state: 'fenced',
        denied: true,
        drained_at: expect.any(String),
        cleanup_drained_at: expect.any(String),
      }),
    ])
  })
})
