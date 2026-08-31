import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDb, type Database } from '#/shared/db'
import {
  GOOGLE_CONTENT_APPROVAL_ROLES,
  GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
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
import { googleReplyTextDigest } from '#/shared/domain/google-reply-text'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { withPublicationAuthorizationFixtureMutation } from '#/shared/testing/reply-publication-authorization-fixtures'

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
  routeCatalogueVersion: GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
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

const runtimeBindingFromCandidate = (
  approvalCandidate: GoogleContentApprovalCandidate,
): GoogleContentRuntimeBinding => {
  const {
    approvedAt: _approvedAt,
    expiresAt: _expiresAt,
    status: _status,
    ...runtime
  } = approvalCandidate.binding
  return runtime
}

const candidateRevision = (revision: string): GoogleContentApprovalCandidate => {
  const base = candidate()
  const releaseSha = `release-${revision}`
  const evidenceManifestSha256 = canonicalGoogleContentSha256(`manifest-${revision}`)
  const roleDocuments = base.roleDocuments.map(({ document }) => {
    const revised = {
      ...document,
      releaseSha,
      manifestSha256: evidenceManifestSha256,
      signature: `${document.role}-${revision}-signature`,
    }
    return { sha256: canonicalGoogleContentSha256(revised), document: revised }
  })
  const indexDocument = {
    manifestSha256: evidenceManifestSha256,
    artifactSha256: base.index.artifactSha256,
    roleDocumentSha256: Object.fromEntries(
      roleDocuments.map(({ sha256, document }) => [document.role, sha256]),
    ) as GoogleContentApprovalCandidate['index']['roleDocumentSha256'],
  }
  const index = {
    ...indexDocument,
    sha256: canonicalGoogleContentSha256(indexDocument),
  }
  return {
    binding: {
      ...base.binding,
      releaseSha,
      evidenceManifestSha256,
      evidenceIndexSha256: index.sha256,
    },
    index,
    roleDocuments,
  }
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

let dynamicAuthorizationFixture:
  | Readonly<{
      organization: string
      property: string
    }>
  | undefined

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

afterEach(async () => {
  const fixture = dynamicAuthorizationFixture
  dynamicAuthorizationFixture = undefined
  if (!fixture) return
  await withPublicationAuthorizationFixtureMutation(() =>
    db.transaction(async (tx) => {
      await tx.execute(sql`
        DELETE FROM credential_revoke_permits AS revoke_permit
        USING google_credential_source_operations AS source_operation
        WHERE revoke_permit.source_operation_id = source_operation.id
          AND source_operation.organization_id = ${fixture.organization}
      `)
      await tx.execute(sql`
        DELETE FROM credential_revoke_permits AS revoke_permit
        USING authorization_execution_permits AS execution_permit
        WHERE revoke_permit.cleanup_work_permit_id = execution_permit.id
          AND execution_permit.organization_id = ${fixture.organization}
      `)
      await tx.execute(sql`
        DELETE FROM google_credential_source_operations
        WHERE organization_id = ${fixture.organization}
      `)
      await tx.execute(sql`
        DELETE FROM authorization_execution_permits
        WHERE organization_id = ${fixture.organization}
      `)
      await tx.execute(sql`
        DELETE FROM reply_publication_attempts
        WHERE organization_id = ${fixture.organization}
      `)
      await tx.execute(sql`
        DELETE FROM reply_publication_authorizations
        WHERE organization_id = ${fixture.organization}
      `)
      await tx.execute(sql`
        DELETE FROM replies
        WHERE organization_id = ${fixture.organization}
      `)
      await tx.execute(sql`
        DELETE FROM material_review_revisions
        WHERE organization_id = ${fixture.organization}
      `)
      await tx.execute(sql`
        DELETE FROM reviews
        WHERE organization_id = ${fixture.organization}
      `)
      await tx.execute(sql`
        DELETE FROM property_capability
        WHERE property_id = ${fixture.property}::uuid
      `)
      await tx.execute(sql`
        DELETE FROM properties
        WHERE organization_id = ${fixture.organization}
      `)
      await tx.execute(sql`
        DELETE FROM google_connections
        WHERE organization_id = ${fixture.organization}
      `)
      await tx.execute(sql`
        DELETE FROM organization_capability
        WHERE organization_id = ${fixture.organization}
      `)
      await tx.execute(sql`
        DELETE FROM permission_version
        WHERE organization_id = ${fixture.organization}
      `)
    }),
  )
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

  it('resolves the newest exact runtime approval while retaining older approval IDs', async () => {
    const store = createGoogleContentAuthorityRepository(db)
    const retainedCandidate = candidateRevision('retained-runtime')
    const replacementCandidate = candidateRevision('replacement-runtime')
    const retained = await store.transaction((tx) =>
      store.appendApproval(tx, retainedCandidate),
    )
    const replacement = await store.transaction((tx) =>
      store.appendApproval(tx, replacementCandidate),
    )

    await expect(
      store.transaction((tx) =>
        store.loadApprovalForRuntime(tx, runtimeBindingFromCandidate(retainedCandidate)),
      ),
    ).resolves.toEqual(retained)
    await expect(
      store.transaction((tx) =>
        store.loadApprovalForRuntime(
          tx,
          runtimeBindingFromCandidate(replacementCandidate),
        ),
      ),
    ).resolves.toEqual(replacement)
    await expect(
      store.transaction((tx) => store.loadApprovalById(tx, retained.id)),
    ).resolves.toEqual(retained)
    await expect(
      store.transaction((tx) => store.ensureApproval(tx, replacementCandidate)),
    ).resolves.toEqual({ record: replacement, inserted: false })

    const conflictingCandidate = {
      ...replacementCandidate,
      roleDocuments: replacementCandidate.roleDocuments.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              document: {
                ...entry.document,
                signature: `${entry.document.signature}-conflict`,
              },
            }
          : entry,
      ),
    }
    await expect(
      store.transaction((tx) => store.ensureApproval(tx, conflictingCandidate)),
    ).rejects.toThrow('google_content_approval_runtime_binding_conflict')
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
        killedCapabilities: ['property.connect_gbp', 'property.publish_reply'],
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
        killedCapabilities: [
          'property.import_gbp_v2',
          'property.connect_gbp',
          'property.publish_reply',
        ],
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
      {
        capability: 'property.connect_gbp',
        denied: true,
        emergency_kill_version: deniedGeneration.toString(),
      },
      {
        capability: 'property.publish_reply',
        denied: true,
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
    const manager = `manager-${randomUUID()}`
    const staff = `staff-${randomUUID()}`
    const connection = randomUUID()
    const property = randomUUID()
    dynamicAuthorizationFixture = {
      organization,
      property,
    }
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
      INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES
        (${manager}, 'Google authority manager', ${`${manager}@example.test`}, true, ${now}, ${now}),
        (${staff}, 'Google authority staff', ${`${staff}@example.test`}, true, ${now}, ${now})
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
      INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
      VALUES
        (${randomUUID()}, ${manager}, ${organization}, 'admin', ${now}),
        (${randomUUID()}, ${staff}, ${organization}, 'member', ${now})
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
        ${`former-connector-${connection}`},
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
        principalKind: 'user',
        role: 'AccountAdmin',
        permissionVersion: expect.any(Number),
        connectionLifecycleVersion: 3,
        connectionAccessVersion: 4,
        credentialGeneration: 5,
      },
    })
    if (!decision.allowed) throw new Error('expected authorization')
    expect(decision.vector.permissionDigest).toMatch(/^[a-f0-9]{64}$/)

    const permissionVersionBefore = decision.vector.permissionVersion
    await db.execute(sql`
      UPDATE permission_version
      SET version = version + 1
      WHERE organization_id = ${organization}
    `)
    const generationDecision = await db.transaction((tx) =>
      authorize(tx as unknown as Database, {
        capability: 'property.import_gbp_v2',
        scope: {
          organizationId: organization,
          propertyId: null,
          connectionId: connection,
          initiatorUserId: user,
        },
        operationKey: 'import.permission_generation',
        vectorMode: 'full',
      }),
    )
    expect(generationDecision).toMatchObject({
      allowed: true,
      vector: { permissionVersion: Number(permissionVersionBefore) + 1 },
    })

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

    await expect(
      db.transaction((tx) =>
        authorize(tx as unknown as Database, {
          capability: 'property.import_gbp_v2',
          scope: {
            organizationId: organization,
            propertyId: null,
            connectionId: connection,
            initiatorUserId: manager,
          },
          operationKey: 'import.manager_denied',
          vectorMode: 'full',
        }),
      ),
    ).resolves.toEqual({ allowed: false, code: 'authorization_denied' })

    await expect(
      db.transaction((tx) =>
        authorize(tx as unknown as Database, {
          capability: 'property.read_gbp_performance',
          scope: {
            organizationId: organization,
            propertyId: property,
            connectionId: connection,
            initiatorUserId: manager,
          },
          operationKey: 'performance.manager_allowed',
          vectorMode: 'full',
        }),
      ),
    ).resolves.toMatchObject({
      allowed: true,
      vector: { principalKind: 'user', role: 'PropertyManager' },
    })

    await expect(
      db.transaction((tx) =>
        authorize(tx as unknown as Database, {
          capability: 'property.read_gbp_performance',
          scope: {
            organizationId: organization,
            propertyId: property,
            connectionId: connection,
            initiatorUserId: staff,
          },
          operationKey: 'performance.staff_denied',
          vectorMode: 'full',
        }),
      ),
    ).resolves.toEqual({ allowed: false, code: 'authorization_denied' })

    await db.execute(sql`
      INSERT INTO organization_capability (organization_id, capability)
      VALUES (${organization}, 'property.connect_gbp')
    `)
    await db.execute(sql`
      INSERT INTO property_capability (property_id, capability)
      VALUES (${property}::uuid, 'property.connect_gbp')
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
      WHERE capability = 'property.connect_gbp'
    `)
    await expect(
      db.transaction((tx) =>
        authorize(tx as unknown as Database, {
          capability: 'property.connect_gbp',
          scope: {
            organizationId: organization,
            propertyId: property,
            connectionId: connection,
            initiatorUserId: null,
          },
          operationKey: 'review.sync',
          vectorMode: 'full',
        }),
      ),
    ).resolves.toMatchObject({
      allowed: true,
      vector: {
        principalKind: 'system',
        systemPrincipal: 'review-sync-worker-v1',
        role: 'System',
        permissionVersion: null,
        propertySourceEpoch: 7,
      },
    })

    for (const operationKey of [
      'notifications.manage',
      'provider.notifications.subscribe',
    ]) {
      await expect(
        db.transaction((tx) =>
          authorize(tx as unknown as Database, {
            capability: 'property.connect_gbp',
            scope: {
              organizationId: organization,
              propertyId: property,
              connectionId: connection,
              initiatorUserId: null,
            },
            operationKey,
            vectorMode: 'full',
          }),
        ),
      ).resolves.toMatchObject({
        allowed: true,
        vector: {
          principalKind: 'system',
          systemPrincipal: 'notification-management-worker-v1',
          role: 'System',
          permissionVersion: null,
          propertySourceEpoch: 7,
        },
      })
    }

    const publicationReview = randomUUID()
    const publicationReply = randomUUID()
    const publicationDigest = googleReplyTextDigest('Approved reply text')
    await db.execute(sql`
      INSERT INTO organization_capability (organization_id, capability)
      VALUES (${organization}, 'property.publish_reply')
    `)
    await db.execute(sql`
      INSERT INTO property_capability (property_id, capability)
      VALUES (${property}::uuid, 'property.publish_reply')
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
      WHERE capability = 'property.publish_reply'
    `)
    await db.execute(sql`
      INSERT INTO reviews (
        id, organization_id, property_id, platform, external_id,
        external_location_id, google_connection_id, source_epoch,
        source_revision, analysis_sequence, source_content_state
      ) VALUES (
        ${publicationReview}::uuid, ${organization}, ${property}::uuid,
        'google', ${`provider-${publicationReview}`},
        ${GOOGLE_LOCATION_PRIMARY_RESOURCE}, ${connection}::uuid,
        7, 9, 0, 'active'
      )
    `)
    await db.execute(sql`
      INSERT INTO material_review_revisions (
        review_id, revision, organization_id, property_id, source_epoch,
        normalization_version, source_digest, normalized_digest, rating,
        normalized_text, content_state
      ) VALUES (
        ${publicationReview}::uuid, 9, ${organization}, ${property}::uuid, 7,
        'review-material-v1', ${'1'.repeat(64)}, ${'2'.repeat(64)}, 5,
        'A helpful review', 'active'
      )
    `)
    await db.execute(sql`
      INSERT INTO replies (
        id, review_id, organization_id, text, status, source, created_by,
        approved_by, ai_generated, authorship, state_revision, approved_at,
        publication_state, publication_cycle, publication_attempts
      ) VALUES (
        ${publicationReply}::uuid, ${publicationReview}::uuid, ${organization},
        'Approved reply text', 'approved', 'internal', ${manager}, ${manager},
        false, 'human', 1, ${now}, 'sending', 3, 2
      )
    `)
    await db.execute(sql`
      INSERT INTO reply_publication_authorizations (
        organization_id, property_id, review_id, reply_id,
        publication_cycle, source_epoch, material_review_revision,
        base_observation_revision, authorized_by_user_id,
        reply_state_revision, normalization_version, expected_reply_digest,
        authorized_at
      ) VALUES (
        ${organization}, ${property}::uuid, ${publicationReview}::uuid,
        ${publicationReply}::uuid, 3, 7, 9, 4, ${manager}, 1,
        'google-reply-v1', ${publicationDigest}, ${now}
      )
    `)
    await db.execute(sql`
      INSERT INTO reply_publication_attempts (
        organization_id, property_id, review_id, reply_id,
        publication_cycle, attempt_number, provider_operation_key,
        source_epoch, material_review_revision, reply_state_revision,
        base_observation_revision, normalization_version,
        expected_reply_digest, outcome
      ) VALUES (
        ${organization}, ${property}::uuid, ${publicationReview}::uuid,
        ${publicationReply}::uuid, 3, 2, ${`publish:${publicationReply}:3:2`},
        7, 9, 1, 4, 'google-reply-v1', ${publicationDigest}, 'sending'
      )
    `)

    const publicationInput = (
      overrides: {
        publicationCycle?: number
        attemptNumber?: number
        sourceEpoch?: number
        materialReviewRevision?: number
      } = {},
    ) => ({
      capability: 'property.publish_reply' as const,
      scope: {
        organizationId: organization,
        propertyId: property,
        connectionId: connection,
        initiatorUserId: null,
        publication: {
          reviewId: publicationReview,
          replyId: publicationReply,
          publicationCycle: overrides.publicationCycle ?? 3,
          attemptNumber: overrides.attemptNumber ?? 2,
          sourceEpoch: overrides.sourceEpoch ?? 7,
          materialReviewRevision: overrides.materialReviewRevision ?? 9,
        },
      },
      operationKey: 'reply.publish',
      vectorMode: 'full' as const,
    })
    await expect(
      db.transaction((tx) => authorize(tx as unknown as Database, publicationInput())),
    ).resolves.toMatchObject({
      allowed: true,
      vector: {
        principalKind: 'system',
        systemPrincipal: 'reply-publication-worker-v1',
        confirmingActorUserId: manager,
        confirmingActorRole: 'PropertyManager',
        reviewId: publicationReview,
        replyId: publicationReply,
        publicationCycle: 3,
        publicationAttemptNumber: 2,
        materialReviewRevision: 9,
        replyStateRevision: 1,
        baseObservationRevision: 4,
        expectedReplyDigest: publicationDigest,
      },
    })
    for (const stale of [
      publicationInput({ publicationCycle: 4 }),
      publicationInput({ attemptNumber: 3 }),
      publicationInput({ sourceEpoch: 8 }),
      publicationInput({ materialReviewRevision: 10 }),
    ]) {
      await expect(
        db.transaction((tx) => authorize(tx as unknown as Database, stale)),
      ).resolves.toEqual({ allowed: false, code: 'authorization_denied' })
    }
    const revokedManagerAuthorize = createGoogleContentAuthorizationCheck({
      clock: () => now,
      hasActivePropertyGrant: async () => false,
    })
    await expect(
      db.transaction((tx) =>
        revokedManagerAuthorize(tx as unknown as Database, publicationInput()),
      ),
    ).resolves.toEqual({ allowed: false, code: 'authorization_denied' })

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

// ── Tenant isolation ─────────────────────────────────────────────────
// NON-NEGOTIABLE. Before this block the whole file passed with the
// repository's single `organizationId` conjunct removed, because no test ever
// touched the permit table with more than one tenant present.
//
// `nextPermitGeneration` computes MAX(permit_generation) + 1 for a scope. The
// generation is a fencing counter, so an unscoped MAX makes one tenant's
// counter a function of another tenant's traffic: the low-volume tenant jumps
// generations it never issued, and the count itself discloses how much
// authorized Google work the other tenant is doing.
describe('Google Content authority repository — tenant isolation', () => {
  const CAPABILITY = 'property.import_gbp_v2' as const
  const OPERATION_KEY = 'permit-generation-tenant-scope'
  const ORG_A = 'org-gca-tenant-a'
  const ORG_B = 'org-gca-tenant-b'
  const ORG_FRESH = 'org-gca-tenant-c'

  const scopeFor = (organizationId: string) => ({
    organizationId,
    propertyId: null,
    connectionId: null,
    initiatorUserId: null,
  })

  it('nextPermitGeneration counts only the calling tenant permits', async () => {
    const store = createGoogleContentAuthorityRepository(db)
    const approval = await store.transaction((tx) =>
      store.appendApproval(tx, candidate()),
    )

    // A REAL admitted permit in each tenant, with the OTHER tenant far ahead
    // on purpose. Nothing here can pass vacuously: drop the conjunct and ORG_A
    // inherits ORG_B's counter.
    for (const [organizationId, permitGeneration] of [
      [ORG_A, 7],
      [ORG_B, 42],
    ] as const) {
      await db.execute(sql`
        INSERT INTO authorization_execution_permits
          (capability, organization_id, operation_key, route_key, route_catalog_version,
           quota_policy_id, policy_version, emergency_kill_version, approval_binding_id,
           permit_generation, start_vector_mode, commit_vector_mode,
           authorization_vector, state, admitted_at, start_deadline_at)
        VALUES (
          ${CAPABILITY}::google_content_capability,
          ${organizationId},
          ${OPERATION_KEY},
          'import.list_accounts',
          'v1',
          'quota-default',
          1,
          1,
          ${approval.id}::uuid,
          ${permitGeneration},
          'full'::authorization_commit_vector_mode,
          'full'::authorization_commit_vector_mode,
          '{}'::jsonb,
          'admitted'::authorization_execution_permit_state,
          ${now},
          ${new Date(now.getTime() + 60_000)}
        )
      `)
    }
    const seeded = await db.execute(sql`
      SELECT organization_id, permit_generation
      FROM authorization_execution_permits
      ORDER BY organization_id
    `)
    expect(seeded.rows).toEqual([
      { organization_id: ORG_A, permit_generation: '7' },
      { organization_id: ORG_B, permit_generation: '42' },
    ])

    await expect(
      store.transaction((tx) =>
        store.nextPermitGeneration(tx, {
          capability: CAPABILITY,
          scope: scopeFor(ORG_A),
          operationKey: OPERATION_KEY,
        }),
      ),
    ).resolves.toBe(8)
    await expect(
      store.transaction((tx) =>
        store.nextPermitGeneration(tx, {
          capability: CAPABILITY,
          scope: scopeFor(ORG_B),
          operationKey: OPERATION_KEY,
        }),
      ),
    ).resolves.toBe(43)
    // A tenant that has never issued a permit starts at 1, not at the
    // cross-tenant maximum.
    await expect(
      store.transaction((tx) =>
        store.nextPermitGeneration(tx, {
          capability: CAPABILITY,
          scope: scopeFor(ORG_FRESH),
          operationKey: OPERATION_KEY,
        }),
      ),
    ).resolves.toBe(1)
  })
})
