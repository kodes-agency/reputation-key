import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb, type Database } from '#/shared/db'
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
import { createGoogleContentAuthorizationCheck } from '#/contexts/integration/infrastructure/google-content-authorization-check'
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
  railwayClosedBetaCohort: null,
  railwayClosedBetaCohortSha256: null,
  railwayClosedBetaResidualRiskSha256: null,
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
  railwayClosedBetaResidualDecision: null,
  railwayClosedBetaCohortSha256: null,
  railwayClosedBetaResidualRiskSha256: null,
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

  it('keeps unrelated capability controls current across generation changes', async () => {
    const store = createGoogleContentAuthorityRepository(db)
    const importGeneration = await store.transaction((tx) =>
      store.allowCapability(tx, 'property.import_gbp_v2', {
        operatorId: 'operator-1',
        reason: 'enable import',
        changedAt: now,
      }),
    )
    const performanceGeneration = await store.transaction((tx) =>
      store.allowCapability(tx, 'property.read_gbp_performance', {
        operatorId: 'operator-1',
        reason: 'enable performance',
        changedAt: now,
      }),
    )
    expect(performanceGeneration).toBe(importGeneration + 1)

    await expect(store.transaction((tx) => store.loadControl(tx))).resolves.toMatchObject(
      {
        emergencyKillVersion: performanceGeneration,
        killedCapabilities: [],
      },
    )

    const deniedGeneration = await store.transaction((tx) =>
      store.denyCapability(tx, 'property.import_gbp_v2', {
        operatorId: 'operator-1',
        reason: 'contain import',
        deniedAt: now,
      }),
    )
    await expect(store.transaction((tx) => store.loadControl(tx))).resolves.toMatchObject(
      {
        emergencyKillVersion: deniedGeneration,
        killedCapabilities: ['property.import_gbp_v2'],
      },
    )
    const rows = await db.execute(sql`
      SELECT capability, denied, emergency_kill_version
      FROM capability_execution_control
      ORDER BY capability
    `)
    expect(rows.rows).toEqual([
      {
        capability: 'property.import_gbp_v2',
        denied: true,
        emergency_kill_version: deniedGeneration.toString(),
      },
      {
        capability: 'property.read_gbp_performance',
        denied: false,
        emergency_kill_version: deniedGeneration.toString(),
      },
    ])
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
    const installed = await authority.installApproval(approvalBundle())
    expect(installed).toMatchObject({ ok: true })
    if (!installed.ok) throw new Error('expected approval installation')
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
      expectedApprovalBindingId: installed.approvalBindingId,
      expectedAuthorizationVector: {
        membershipGeneration: 7,
        credentialGeneration: 2,
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
  it('derives the complete authorization vector from one transaction snapshot', async () => {
    const organization = `org-${randomUUID()}`
    const user = `user-${randomUUID()}`
    const connection = randomUUID()
    const property = randomUUID()
    await db.execute(sql`
      INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES (
        ${user},
        'Google authority test',
        ${`${user}@example.test`},
        true,
        ${now},
        ${now}
      )
    `)
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${organization}, 'Google authority test', ${organization}, ${now})
    `)
    await db.execute(sql`
      INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
      VALUES (${randomUUID()}, ${user}, ${organization}, 'owner', ${now})
    `)
    await db.execute(sql`
      INSERT INTO organization_capability (organization_id, capability)
      VALUES (${organization}, 'property.import_gbp_v2')
    `)
    await db.execute(sql`
      INSERT INTO google_connections (
        id, organization_id, google_subject, encrypted_access_token,
        encrypted_refresh_token, token_expires_at, scopes, connected_by,
        visibility, status, credential_use_state, lifecycle_version,
        access_version, credential_generation, encryption_key_id
      )
      VALUES (
        ${connection}::uuid,
        ${organization},
        ${`subject-${connection}`},
        'encrypted-access',
        'encrypted-refresh',
        ${new Date('2026-08-12T12:00:00.000Z')},
        ARRAY['https://www.googleapis.com/auth/business.manage']::text[],
        ${user},
        'organization',
        'active',
        'active',
        3,
        4,
        5,
        'v1'
      )
    `)
    await db.execute(sql`
      INSERT INTO organization_capability (organization_id, capability)
      VALUES (${organization}, 'property.read_gbp_performance')
    `)
    await db.execute(sql`
      INSERT INTO properties (
        id,
        organization_id,
        name,
        slug,
        timezone,
        google_connection_id,
        gbp_account_id,
        gbp_location_id,
        profile_version,
        google_binding_state,
        profile_source,
        profile_confirmed_at,
        profile_confirmed_by,
        lifecycle_state,
        source_epoch
      )
      VALUES (
        ${property}::uuid,
        ${organization},
        'Performance property',
        ${`performance-${property}`},
        'America/New_York',
        ${connection}::uuid,
        '123',
        '456',
        8,
        'active',
        'tenant_confirmed',
        ${now},
        ${user},
        'active',
        7
      )
    `)
    await db.execute(sql`
      INSERT INTO property_capability (property_id, capability)
      VALUES (${property}::uuid, 'property.read_gbp_performance')
    `)
    await db.execute(sql`
      UPDATE capability_execution_control
      SET denied = false,
          emergency_kill_version = (
            SELECT emergency_kill_version FROM policy_version WHERE scope = 'global'
          ),
          denied_at = NULL,
          drained_at = NULL,
          cleanup_drained_at = NULL
      WHERE capability = 'property.import_gbp_v2'
    `)
    await db.execute(sql`
      UPDATE capability_execution_control
      SET denied = false,
          emergency_kill_version = (
            SELECT emergency_kill_version FROM policy_version WHERE scope = 'global'
          ),
          denied_at = NULL,
          drained_at = NULL,
          cleanup_drained_at = NULL
      WHERE capability = 'property.read_gbp_performance'
    `)

    const authorize = createGoogleContentAuthorizationCheck({
      clock: () => now,
      hasActivePropertyGrant: async () => true,
    })
    const decision = await db.transaction((tx) =>
      authorize(tx as unknown as Database, {
        capability: 'property.import_gbp_v2',
        scope: {
          organizationId: organization,
          propertyId: null,
          connectionId: connection,
          initiatorUserId: user,
        },
        operationKey: 'import.list_accounts',
        vectorMode: 'full',
      }),
    )
    expect(decision).toMatchObject({
      allowed: true,
      vector: {
        executionPolicyVersion: 'beta-local-2',
        role: 'AccountAdmin',
        connectionLifecycleVersion: 3,
        connectionAccessVersion: 4,
        credentialGeneration: 5,
      },
    })
    if (!decision.allowed) throw new Error('expected authorization')
    expect(decision.vector.permissionDigest).toMatch(/^[a-f0-9]{64}$/)

    const performanceDecision = await db.transaction((tx) =>
      authorize(tx as unknown as Database, {
        capability: 'property.read_gbp_performance',
        scope: {
          organizationId: organization,
          propertyId: property,
          connectionId: connection,
          initiatorUserId: user,
        },
        operationKey: 'performance.before_provider',
        vectorMode: 'full',
      }),
    )
    expect(performanceDecision).toMatchObject({
      allowed: true,
      vector: {
        propertySourceEpoch: 7,
        propertyProfileVersion: 8,
        propertyBindingState: 'active',
        propertyLifecycleState: 'active',
        propertyProfileSource: 'tenant_confirmed',
        propertyTimezoneConfirmed: true,
      },
    })

    await db.execute(sql`
      UPDATE properties
      SET source_epoch = 8
      WHERE id = ${property}::uuid
    `)
    await expect(
      db.transaction((tx) =>
        authorize(tx as unknown as Database, {
          capability: 'property.read_gbp_performance',
          scope: {
            organizationId: organization,
            propertyId: property,
            connectionId: connection,
            initiatorUserId: user,
          },
          operationKey: 'performance.lease_renewal',
          vectorMode: 'full',
        }),
      ),
    ).resolves.toMatchObject({
      allowed: true,
      vector: { propertySourceEpoch: 8 },
    })

    await db.execute(sql`
      DELETE FROM organization_capability
      WHERE organization_id = ${organization}
        AND capability = 'property.import_gbp_v2'
    `)
    await expect(
      db.transaction((tx) =>
        authorize(tx as unknown as Database, {
          capability: 'property.import_gbp_v2',
          scope: {
            organizationId: organization,
            propertyId: null,
            connectionId: connection,
            initiatorUserId: user,
          },
          operationKey: 'import.list_accounts',
          vectorMode: 'full',
        }),
      ),
    ).resolves.toEqual({ allowed: false, code: 'authorization_denied' })
  })
})
