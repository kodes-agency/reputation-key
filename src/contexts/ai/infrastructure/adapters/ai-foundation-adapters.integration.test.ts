import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  merchantAiConsentEvidence,
  merchantAiEnablement,
  properties,
  reviewAiAnalysisHeads,
} from '#/shared/db/schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { createAiAuthorizationAdapter } from './ai-authorization.adapter'
import { createAiPropertyCalendarAdapter } from './ai-property-calendar.adapter'
import { createPropertyProcessingProfileAdapter } from './property-processing-profile.adapter'

const NOW = new Date('2026-08-16T14:00:00.000Z')
const ORGANIZATION_ID = organizationId('ai-foundation-adapters-test-org')
const PROPERTY_ID = propertyId('73000000-0000-4000-8000-000000000001')
const LINEAGE_ID = '73000000-0000-4000-8000-000000000002'

describe('AI authorization and processing-profile adapters (real PostgreSQL)', () => {
  const db = getDb()
  const authorization = createAiAuthorizationAdapter(db)
  const profiles = createPropertyProcessingProfileAdapter(db, () => NOW)
  const calendar = createAiPropertyCalendarAdapter(db)

  const clear = async () => {
    await db.delete(properties).where(eq(properties.id, PROPERTY_ID))
    await deleteTestOrganizations(db, [ORGANIZATION_ID])
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
