import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  aiOperationProfiles,
  aiProviderDeploymentProfiles,
  aiRoutingPolicies,
  merchantAiConsentEvidence,
  merchantAiEnablement,
  properties,
  reviewAiAnalysisHeads,
} from '#/shared/db/schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import {
  AI_OPERATION_PROFILES,
  AI_PROVIDER_DEPLOYMENT_PROFILE,
  AI_ROUTING_POLICY,
} from '#/shared/ai-operation-profiles'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { createAiAuthorizationAdapter } from './ai-authorization.adapter'
import { AI_RUNTIME_CAPABILITIES_V1_DIGEST } from '#/shared/ai-runtime-capability-contract'
import { createAiRuntimeCatalogueAdapter } from './ai-runtime-catalogue.adapter'
import { createAiPropertyCalendarAdapter } from './ai-property-calendar.adapter'
import { createPropertyProcessingProfileAdapter } from './property-processing-profile.adapter'

const NOW = new Date('2026-08-16T14:00:00.000Z')
const ORGANIZATION_ID = organizationId('ai-foundation-adapters-test-org')
const PROPERTY_ID = propertyId('73000000-0000-4000-8000-000000000001')
const LINEAGE_ID = '73000000-0000-4000-8000-000000000002'

describe('AI authorization and processing-profile adapters (real PostgreSQL)', () => {
  const db = getDb()
  const authorization = createAiAuthorizationAdapter(db)
  const runtimeCatalogue = createAiRuntimeCatalogueAdapter(db)
  const profiles = createPropertyProcessingProfileAdapter(db, runtimeCatalogue)
  const calendar = createAiPropertyCalendarAdapter(db)

  const clear = async () => {
    await db.delete(properties).where(eq(properties.id, PROPERTY_ID))
    await db.execute(sql`DELETE FROM organization WHERE id = ${ORGANIZATION_ID}`)
  }

  beforeAll(async () => {
    await clear()
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORGANIZATION_ID}, 'AI foundation adapters test', ${ORGANIZATION_ID}, ${NOW})
    `)
    await db.insert(properties).values({
      id: PROPERTY_ID,
      organizationId: ORGANIZATION_ID,
      name: 'AI foundation test property',
      slug: 'ai-foundation-test-property',
      timezone: 'America/New_York',
      countryCode: 'US',
      processingRegion: 'global',
      routingPolicyVersion: 1,
      profileVersion: 3,
      sourceEpoch: 2,
    })
    await db.insert(reviewAiAnalysisHeads).values({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: 2,
      headSequence: 11,
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  afterAll(clear)

  it('persists the exact immutable AI profile catalogue', async () => {
    const persisted = await db
      .select({
        profileVersion: aiOperationProfiles.profileVersion,
        profileDigest: aiOperationProfiles.profileDigest,
      })
      .from(aiOperationProfiles)
    expect(
      [...persisted].sort((left, right) =>
        left.profileVersion.localeCompare(right.profileVersion),
      ),
    ).toEqual(
      [...AI_OPERATION_PROFILES]
        .map(({ profileVersion, profileDigest }) => ({
          profileVersion,
          profileDigest,
        }))
        .sort((left, right) => left.profileVersion.localeCompare(right.profileVersion)),
    )

    const [provider] = await db
      .select({
        profileVersion: aiProviderDeploymentProfiles.profileVersion,
        profileDigest: aiProviderDeploymentProfiles.profileDigest,
        deploymentContract: aiProviderDeploymentProfiles.deploymentContract,
      })
      .from(aiProviderDeploymentProfiles)
      .where(
        eq(
          aiProviderDeploymentProfiles.profileVersion,
          AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
        ),
      )
      .limit(1)
    expect(provider).toEqual({
      profileVersion: AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
      profileDigest: AI_PROVIDER_DEPLOYMENT_PROFILE.profileDigest,
      deploymentContract: AI_PROVIDER_DEPLOYMENT_PROFILE.deploymentContract,
    })

    const [routing] = await db
      .select({
        version: aiRoutingPolicies.version,
        policyDigest: aiRoutingPolicies.policyDigest,
      })
      .from(aiRoutingPolicies)
      .where(eq(aiRoutingPolicies.version, AI_ROUTING_POLICY.version))
      .limit(1)
    expect(routing).toEqual({
      version: AI_ROUTING_POLICY.version,
      policyDigest: AI_ROUTING_POLICY.policyDigest,
    })
  })

  it('resolves every runtime capability through the exact persisted catalogue', async () => {
    await expect(runtimeCatalogue.assertComplete()).resolves.toBe(true)
    for (const capability of [
      'review_analysis',
      'reply_drafting',
      'property_trends',
    ] as const) {
      const resolved = await runtimeCatalogue.resolveCapability(capability)
      expect(resolved).toMatchObject({
        status: 'available',
        catalogue: {
          runtime: { capability },
          operation: { capability },
          providerDeploymentProfileVersion: 'private-beta-global-v1',
          routingPolicyVersion: 1,
        },
      })
      if (resolved.status !== 'available') {
        throw new Error(`runtime catalogue did not resolve ${capability}`)
      }
      expect(resolved.catalogue.runtime.operationProfileVersion).toBe(
        resolved.catalogue.operation.profileVersion,
      )
    }
  })

  it('requires the complete exact migration catalogue at the database readiness boundary', async () => {
    const readReady = async (executor: Pick<typeof db, 'execute'>): Promise<boolean> => {
      const result = await executor.execute(sql`
        SELECT assert_ai_runtime_catalogue_ready_v1(
          ${AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion},
          ${AI_PROVIDER_DEPLOYMENT_PROFILE.profileDigest},
          ${AI_RUNTIME_CAPABILITIES_V1_DIGEST}
        ) AS ready
      `)
      return (
        (result as unknown as { rows: Array<{ ready: boolean }> }).rows[0]?.ready === true
      )
    }

    await expect(readReady(db)).resolves.toBe(true)
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`
          ALTER TABLE "ai_provider_deployment_capabilities"
          DISABLE TRIGGER "ai_provider_deployment_capabilities_immutable"
        `)
        await tx.execute(sql`
          DELETE FROM "ai_provider_deployment_capabilities"
          WHERE "capability" = 'property_trends'
        `)
        expect(await readReady(tx as Pick<typeof db, 'execute'>)).toBe(false)
        throw new Error('rollback catalogue mutation probe')
      }),
    ).rejects.toThrow('rollback catalogue mutation probe')
    await expect(readReady(db)).resolves.toBe(true)
  })

  it('rejects every direct immutable-catalogue mutation and remains ready', async () => {
    await expect(
      db.execute(sql`
        UPDATE "ai_runtime_capability_profiles"
        SET "gateway_path" = '/v1/tampered'
        WHERE "runtime_profile_version" = 'review-analysis-runtime-v1'
      `),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringMatching(/immutable|catalogue/i),
      }),
    })
    await expect(
      db.execute(sql`
        DELETE FROM "ai_operation_profiles"
        WHERE "profile_version" = 'synthetic-canary-v1'
      `),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringMatching(/immutable|catalogue/i),
      }),
    })
    await expect(runtimeCatalogue.assertComplete()).resolves.toBe(true)
  })

  it('uses the immutable calendar function for property-local dates', async () => {
    await expect(calendar.assertComplete()).resolves.toBe(true)
    await expect(
      calendar.resolveLocalDate({
        reviewedAtEpochMillis: Date.parse('2025-11-02T05:30:00.000Z'),
        timezone: 'America/New_York',
        calendarProfileVersion: 'property-calendar-v1',
      }),
    ).resolves.toBe('2025-11-02')
    await expect(
      calendar.resolveLocalDate({
        reviewedAtEpochMillis: Date.parse('2025-11-02T05:30:00.000Z'),
        timezone: 'Not/A-Timezone',
        calendarProfileVersion: 'property-calendar-v1',
      }),
    ).resolves.toBeNull()
  })

  it('materializes the property AI processing profile on an unfenced read and still fences a fenced one', async () => {
    // This adapter is the only writer of ai_property_processing_profiles, so an
    // unfenced read must materialize the row: when it returned
    // policy_unavailable instead, every AI operation terminal-skipped forever.
    const materialized = await profiles.readForAi({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
    })
    expect(materialized).toMatchObject({
      status: 'available',
      profile: {
        countryCode: 'US',
        timezone: 'America/New_York',
        processingRegion: 'global',
        routingPolicyVersion: 1,
        sourceEpoch: 2,
        profileVersion: 1,
      },
    })

    // An explicit refresh of an already-current profile is idempotent.
    await expect(
      profiles.refreshForAi({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
      }),
    ).resolves.toEqual(materialized)

    await expect(
      profiles.readForAi({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        expected: {
          sourceEpoch: 2,
          propertyProfileVersion: 1,
          routingPolicyVersion: 1,
        },
      }),
    ).resolves.toEqual(materialized)

    await db
      .update(properties)
      .set({ timezone: 'Europe/Berlin', profileVersion: 4 })
      .where(eq(properties.id, PROPERTY_ID))

    // A fenced read must report the drift so the in-flight operation fences.
    await expect(
      profiles.readForAi({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        expected: {
          sourceEpoch: 2,
          propertyProfileVersion: 1,
          routingPolicyVersion: 1,
        },
      }),
    ).resolves.toEqual({ status: 'property_profile_changed' })

    // An unfenced read reconciles to the property's current facts.
    await expect(
      profiles.readForAi({ organizationId: ORGANIZATION_ID, propertyId: PROPERTY_ID }),
    ).resolves.toMatchObject({
      status: 'available',
      profile: { timezone: 'Europe/Berlin', profileVersion: 2 },
    })
  })

  it('projects the exact enabled capability epochs and immutable policy facts', async () => {
    await expect(
      authorization.readMerchantAuthorization({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
      }),
    ).resolves.toBeNull()

    const capabilityRuntimeProfileVersions = {
      review_analysis: 'review-analysis-runtime-v1',
      property_trends: 'property-trends-runtime-v1',
    } as const
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
      await tx.insert(merchantAiConsentEvidence).values({
        authorizationLineageId: LINEAGE_ID,
        stateVersion: 1,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        transitionKind: 'enable',
        state: 'enabled',
        capabilities: ['review_analysis', 'property_trends'],
        capabilityRuntimeProfileVersions,
        reviewAnalysisEpoch: 1,
        replyDraftingEpoch: 1,
        propertyTrendsEpoch: 1,
        authorizedSourceEpoch: 2,
        analysisStartSequence: 11,
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
        sourcePolicyId: 'google-business-profile-source-policy-v1',
        routingPolicyVersion: 1,
        processingRegion: 'global',
        providerDeploymentProfileVersion: 'private-beta-global-v1',
        redactionProfileFamily: 'gbp-review-global-v1',
        actorUserId: 'ai-foundation-test-actor',
        reasonCode: 'merchant_enabled',
        idempotencyKey: 'ai-foundation-enable-v1',
        requestHash: 'b'.repeat(64),
        occurredAt: NOW,
      })
      await tx.insert(merchantAiEnablement).values({
        propertyId: PROPERTY_ID,
        organizationId: ORGANIZATION_ID,
        authorizationLineageId: LINEAGE_ID,
        state: 'enabled',
        capabilities: ['review_analysis', 'property_trends'],
        capabilityRuntimeProfileVersions,
        reviewAnalysisEpoch: 1,
        replyDraftingEpoch: 1,
        propertyTrendsEpoch: 1,
        authorizedSourceEpoch: 2,
        analysisStartSequence: 11,
        stateVersion: 1,
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
        sourcePolicyId: 'google-business-profile-source-policy-v1',
        routingPolicyVersion: 1,
        processingRegion: 'global',
        providerDeploymentProfileVersion: 'private-beta-global-v1',
        redactionProfileFamily: 'gbp-review-global-v1',
        updatedBy: 'ai-foundation-test-actor',
        updatedAt: NOW,
      })
    })

    await expect(
      authorization.readMerchantAuthorization({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
      }),
    ).resolves.toMatchObject({
      state: 'enabled',
      stateVersion: 1,
      authorizationLineageId: LINEAGE_ID,
      capabilities: ['review_analysis', 'property_trends'],
      capabilityRuntimeProfileVersions,
      capabilityEpochs: {
        review_analysis: { epoch: 1, changedAtEpochMillis: NOW.getTime() },
        reply_drafting: { epoch: 1, changedAtEpochMillis: NOW.getTime() },
        property_trends: { epoch: 1, changedAtEpochMillis: NOW.getTime() },
      },
      reviewAnalysisStartSequence: 11,
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      sourcePolicyId: 'google-business-profile-source-policy-v1',
      redactionProfileFamily: 'gbp-review-global-v1',
      providerDeploymentProfileVersion: 'private-beta-global-v1',
    })
  })
})
