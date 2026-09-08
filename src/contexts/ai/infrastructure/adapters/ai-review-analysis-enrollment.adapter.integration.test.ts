import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  aiReviewAnalysisEnrollments,
  eventConsumerReceipts,
  merchantAiConsentEvidence,
  merchantAiEnablement,
  outboxEvents,
  properties,
  reviewAiAnalysisHeads,
} from '#/shared/db/schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { createReviewAnalysisEnrollmentAdapter } from './ai-review-analysis-enrollment.adapter'

const NOW = new Date('2026-09-08T10:00:00.000Z')
const ORGANIZATION_ID = organizationId('ai-enrollment-adapter-test-org')
const PROPERTY_ID = propertyId('74000000-0000-4000-8000-000000000001')
const LINEAGE_ID = '74000000-0000-4000-8000-000000000002'
const TRIGGER_EVENT_ID = '74000000-0000-4000-8000-000000000003'
const ENROLLMENT_ID = '74000000-0000-4000-8000-000000000004'
// sha256 of the empty revision set: no eligible review exists for the property.
const EMPTY_SET_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

describe('Review Analysis enrollment adapter (real PostgreSQL)', () => {
  const db = getDb()
  const enrollments = createReviewAnalysisEnrollmentAdapter(db, () => ENROLLMENT_ID)

  const clear = async () => {
    await db
      .delete(eventConsumerReceipts)
      .where(eq(eventConsumerReceipts.eventId, TRIGGER_EVENT_ID))
    await db.delete(outboxEvents).where(eq(outboxEvents.id, TRIGGER_EVENT_ID))
    await db.delete(properties).where(eq(properties.id, PROPERTY_ID))
    await deleteTestOrganizations(db, [ORGANIZATION_ID])
  }

  beforeAll(async () => {
    await clear()
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORGANIZATION_ID}, 'AI enrollment adapter test', ${ORGANIZATION_ID}, ${NOW})
    `)
    await db.insert(properties).values({
      id: PROPERTY_ID,
      organizationId: ORGANIZATION_ID,
      name: 'AI enrollment test property',
      slug: 'ai-enrollment-test-property',
      timezone: 'America/New_York',
      countryCode: 'US',
      profileVersion: 1,
      sourceEpoch: 0,
    })
    await db.insert(reviewAiAnalysisHeads).values({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: 0,
      headSequence: 0,
      createdAt: NOW,
      updatedAt: NOW,
    })
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
      await tx.insert(merchantAiConsentEvidence).values({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        authorizationLineageId: LINEAGE_ID,
        stateVersion: 1,
        transitionKind: 'enable',
        state: 'enabled',
        capabilities: ['review_analysis', 'reply_drafting', 'property_trends'],
        capabilityRuntimeProfileVersions: {
          review_analysis: 'review-analysis-runtime-v1',
          reply_drafting: 'reply-drafting-runtime-v1',
          property_trends: 'property-trends-runtime-v1',
        },
        reviewAnalysisEpoch: 1,
        replyDraftingEpoch: 1,
        propertyTrendsEpoch: 1,
        authorizedSourceEpoch: 0,
        analysisStartSequence: 0,
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
        sourcePolicyId: 'google-business-profile-source-policy-v1',
        routingPolicyVersion: 1,
        processingRegion: 'global',
        providerDeploymentProfileVersion: 'private-beta-global-v1',
        redactionProfileFamily: 'gbp-review-global-v1',
        actorUserId: 'ai-enrollment-test-actor',
        reasonCode: 'merchant_enabled',
        idempotencyKey: 'ai-enrollment-enable-v1',
        requestHash: 'c'.repeat(64),
        occurredAt: NOW,
      })
      await tx.insert(merchantAiEnablement).values({
        propertyId: PROPERTY_ID,
        organizationId: ORGANIZATION_ID,
        authorizationLineageId: LINEAGE_ID,
        state: 'enabled',
        capabilities: ['review_analysis', 'reply_drafting', 'property_trends'],
        capabilityRuntimeProfileVersions: {
          review_analysis: 'review-analysis-runtime-v1',
          reply_drafting: 'reply-drafting-runtime-v1',
          property_trends: 'property-trends-runtime-v1',
        },
        reviewAnalysisEpoch: 1,
        replyDraftingEpoch: 1,
        propertyTrendsEpoch: 1,
        authorizedSourceEpoch: 0,
        analysisStartSequence: 0,
        stateVersion: 1,
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
        sourcePolicyId: 'google-business-profile-source-policy-v1',
        routingPolicyVersion: 1,
        processingRegion: 'global',
        providerDeploymentProfileVersion: 'private-beta-global-v1',
        redactionProfileFamily: 'gbp-review-global-v1',
        updatedBy: 'ai-enrollment-test-actor',
        updatedAt: NOW,
      })
    })
    await db.insert(outboxEvents).values({
      id: TRIGGER_EVENT_ID,
      eventType: 'identity.merchant_ai.changed',
      eventVersion: 1,
      payload: { state: 'enabled' },
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceContext: 'identity',
      sourceAggregateId: PROPERTY_ID,
      createdAt: NOW,
    })
  })

  afterAll(clear)

  it('enrols an enabled property by snapshotting its eligible revisions with the built-in sha256', async () => {
    // The digest used to come from pgcrypto's digest(); no cell installs pgcrypto,
    // so the first live enablement failed here and retried forever.
    const result = await enrollments.applyAuthorizationLifecycle({
      eventEnvelopeId: TRIGGER_EVENT_ID,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      authorizationState: 'enabled',
      fence: {
        authorizationLineageId: LINEAGE_ID,
        authorizationStateVersion: 1,
        sourceEpoch: 0,
        reviewAnalysisEpoch: 1,
        replyDraftingEpoch: 1,
        propertyTrendsEpoch: 1,
        analysisStartSequence: 0,
      },
      correlationId: null,
      occurredAt: NOW,
    })

    expect(result).toEqual({
      status: 'applied',
      enrollment: { status: 'queued', enrollmentId: ENROLLMENT_ID },
    })

    const [row] = await db
      .select({
        state: aiReviewAnalysisEnrollments.state,
        count: aiReviewAnalysisEnrollments.snapshotRevisionCount,
        digest: aiReviewAnalysisEnrollments.snapshotRevisionSetDigest,
      })
      .from(aiReviewAnalysisEnrollments)
      .where(eq(aiReviewAnalysisEnrollments.id, ENROLLMENT_ID))
    expect(row).toEqual({ state: 'queued', count: 0, digest: EMPTY_SET_SHA256 })

    const [receipt] = await db
      .select({ status: eventConsumerReceipts.status })
      .from(eventConsumerReceipts)
      .where(eq(eventConsumerReceipts.eventId, TRIGGER_EVENT_ID))
    expect(receipt).toEqual({ status: 'applied' })
  })

  it('records a duplicate trigger without a second enrollment', async () => {
    const result = await enrollments.applyAuthorizationLifecycle({
      eventEnvelopeId: TRIGGER_EVENT_ID,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      authorizationState: 'enabled',
      fence: {
        authorizationLineageId: LINEAGE_ID,
        authorizationStateVersion: 1,
        sourceEpoch: 0,
        reviewAnalysisEpoch: 1,
        replyDraftingEpoch: 1,
        propertyTrendsEpoch: 1,
        analysisStartSequence: 0,
      },
      correlationId: null,
      occurredAt: NOW,
    })
    expect(result).toEqual({ status: 'duplicate', enrollmentId: ENROLLMENT_ID })
  })
})
