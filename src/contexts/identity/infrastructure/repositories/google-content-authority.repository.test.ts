import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDb, type Database } from '#/shared/db'
import { createGoogleContentAuthorizationAuthority } from '#/shared/auth/google-content-authority'
import { createGoogleContentAuthorityRepository } from './google-content-authority.repository'
import { createGoogleContentAuthorizationCheck } from '#/contexts/integration/infrastructure/google-content-authorization-check'
import { closePool } from '#/shared/db/pool'
import { googleReplyTextDigest } from '#/shared/domain/google-reply-text'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { withPublicationAuthorizationFixtureMutation } from '#/shared/testing/reply-publication-authorization-fixtures'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'

const db = getDb()
const now = new Date('2026-08-10T10:00:00.000Z')

let dynamicAuthorizationFixture:
  | Readonly<{
      organization: string
      property: string
    }>
  | undefined


const GOOGLE_POLICY_ENV = {
  NODE_ENV: 'test',
  BETA_E2E_GLOBAL_CAPABILITIES:
    'property.import_gbp_v2,property.read_gbp_performance',
} as const

beforeEach(async () => {
  resetCapabilityPolicyStore()
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore(GOOGLE_POLICY_ENV))
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
        DELETE FROM properties
        WHERE organization_id = ${fixture.organization}
      `)
      await tx.execute(sql`
        DELETE FROM google_connections
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
  resetCapabilityPolicyStore()
  await closePool()
})

describe('Google Content authority repository', () => {
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
      isRegisteredOperator: () => true,
      authorize: async () => ({
        allowed: true,
        vector: { membershipGeneration: 7, credentialGeneration: 2 },
      }),
    })
    await expect(
      authority.allowCapability(
        { capability: 'property.import_gbp_v2' },
        'operator-1',
        'local rollout',
      ),
    ).resolves.toEqual({ ok: true, emergencyKillVersion: 2 })
    const admitted = await authority.admit({
      runtimeBinding: { capability: 'property.import_gbp_v2' },
      scope: {
        organizationId: 'org-1',
        propertyId: null,
        connectionId: null,
        initiatorUserId: 'user-1',
      },
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
    const controlStore = createGoogleContentAuthorityRepository(db)
    await controlStore.transaction(async (tx) => {
      await controlStore.allowCapability(tx, 'property.import_gbp_v2', {
        operatorId: 'operator-test',
        reason: 'authorize import vector',
        changedAt: now,
      })
      await controlStore.allowCapability(tx, 'property.read_gbp_performance', {
        operatorId: 'operator-test',
        reason: 'authorize performance vector',
        changedAt: now,
      })
    })

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
        }),
      ),
    ).resolves.toEqual({ allowed: false, code: 'authorization_denied' })

    await controlStore.transaction((tx) =>
      controlStore.allowCapability(tx, 'property.connect_gbp', {
        operatorId: 'operator-test',
        reason: 'authorize review sync vector',
        changedAt: now,
      }),
    )
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
    await controlStore.transaction((tx) =>
      controlStore.allowCapability(tx, 'property.publish_reply', {
        operatorId: 'operator-test',
        reason: 'authorize publication vector',
        changedAt: now,
      }),
    )
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
        }),
      ),
    ).resolves.toMatchObject({
      allowed: true,
      vector: { propertySourceEpoch: 8 },
    })

    await controlStore.transaction((tx) =>
      controlStore.denyCapability(tx, 'property.import_gbp_v2', {
        operatorId: 'operator-test',
        reason: 'exercise live kill switch',
        deniedAt: now,
      }),
    )
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
        }),
      ),
    ).resolves.toEqual({ allowed: false, code: 'authorization_denied' })
  })
})
