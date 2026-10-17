// A Merchant AI notice that changes only how consent is asked leaves the
// consent given under the one before it in force (merchant-ai-notice-contract.ts).
// The 2026-10-17 notice dropped the Property names from its call to action, and
// a deploy rewrites no enablement head, so a Property consented under
// 2026-09-15 reads back with that notice and must still be under the contract
// this build serves for every capability, or its AI would stop until someone
// re-consented. A notice that changed the consent itself (2026-09-09, before
// the 2026-09-15 ceremony) stays lapsed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { inArray, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  merchantAiConsentEvidence,
  merchantAiEnablement,
  properties,
  reviewAiAnalysisHeads,
} from '#/shared/db/schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { CURRENT_MERCHANT_AI_CAPABILITIES } from '#/shared/domain/merchant-ai-capability'
import { isAiAuthorizationUnderServedContract } from '../../application/ai-workflow-support'
import { createAiAuthorizationAdapter } from './ai-authorization.adapter'

const NOW = new Date('2026-10-17T09:00:00.000Z')
const ORGANIZATION_ID = organizationId('ai-notice-in-force-test-org')
const IN_FORCE_PROPERTY = propertyId('74000000-0000-4000-8000-000000000001')
const LAPSED_PROPERTY = propertyId('74000000-0000-4000-8000-000000000002')
const RUNTIME_PROFILES = {
  review_analysis: 'review-analysis-runtime-v1',
  reply_drafting: 'reply-drafting-runtime-v1',
  property_trends: 'property-trends-runtime-v1',
} as const
const NOTICE_2026_09_15 = {
  noticeVersion: 'merchant-ai-notice-2026-09-15.v1',
  noticeDigest: '6c98ae3bb57b5b142afed1749a1b9f59be8d6ca7edaca3250e39055897289a9c',
} as const
const NOTICE_2026_09_09 = {
  noticeVersion: 'merchant-ai-notice-2026-09-09.v1',
  noticeDigest: 'd80fe3b03f89697cde6c46810053248206aa3745b5f4a5522a24c1c2fdb438e1',
} as const

const db = getDb()
const authorization = createAiAuthorizationAdapter(db)

/** One enabled head and its evidence row, recorded under `notice`. */
async function grantUnder(
  property: string,
  lineageId: string,
  notice: Readonly<{ noticeVersion: string; noticeDigest: string }>,
): Promise<void> {
  const contract = {
    organizationId: ORGANIZATION_ID,
    propertyId: property,
    authorizationLineageId: lineageId,
    state: 'enabled',
    capabilities: [...CURRENT_MERCHANT_AI_CAPABILITIES],
    capabilityRuntimeProfileVersions: RUNTIME_PROFILES,
    reviewAnalysisEpoch: 1,
    replyDraftingEpoch: 1,
    propertyTrendsEpoch: 1,
    authorizedSourceEpoch: 1,
    analysisStartSequence: 0,
    stateVersion: 1,
    ...notice,
    sourcePolicyId: 'google-business-profile-source-policy-v1',
    routingPolicyVersion: 1,
    processingRegion: 'global',
    providerDeploymentProfileVersion: 'private-beta-global-v1',
    redactionProfileFamily: 'gbp-review-global-v1',
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
    await tx.insert(merchantAiConsentEvidence).values({
      ...contract,
      transitionKind: 'enable',
      actorUserId: 'ai-notice-in-force-actor',
      reasonCode: 'merchant_enabled',
      idempotencyKey: `ai-notice-in-force-${property}`,
      requestHash: 'c'.repeat(64),
      occurredAt: NOW,
    })
    await tx.insert(merchantAiEnablement).values({
      ...contract,
      updatedBy: 'ai-notice-in-force-actor',
      updatedAt: NOW,
    })
  })
}

describe('AI authorization under a notice the served one keeps in force (real PostgreSQL)', () => {
  const clear = async () => {
    await db
      .delete(properties)
      .where(inArray(properties.id, [IN_FORCE_PROPERTY, LAPSED_PROPERTY]))
    await deleteTestOrganizations(db, [ORGANIZATION_ID])
  }

  beforeAll(async () => {
    await clear()
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORGANIZATION_ID}, 'AI notice in force test', ${ORGANIZATION_ID}, ${NOW})
    `)
    for (const [index, id] of [IN_FORCE_PROPERTY, LAPSED_PROPERTY].entries()) {
      await db.insert(properties).values({
        id,
        organizationId: ORGANIZATION_ID,
        name: `AI notice test property ${index + 1}`,
        slug: `ai-notice-test-property-${index + 1}`,
        timezone: 'UTC',
        countryCode: 'DE',
        sourceEpoch: 1,
      })
      await db.insert(reviewAiAnalysisHeads).values({
        organizationId: ORGANIZATION_ID,
        propertyId: id,
        sourceEpoch: 1,
        headSequence: 0,
        createdAt: NOW,
        updatedAt: NOW,
      })
    }
    await grantUnder(
      IN_FORCE_PROPERTY,
      '74000000-0000-4000-8000-000000000011',
      NOTICE_2026_09_15,
    )
    await grantUnder(
      LAPSED_PROPERTY,
      '74000000-0000-4000-8000-000000000012',
      NOTICE_2026_09_09,
    )
  })

  afterAll(clear)

  it('keeps every capability of a 2026-09-15 consent under the served contract', async () => {
    const snapshot = await authorization.readMerchantAuthorization({
      organizationId: ORGANIZATION_ID,
      propertyId: IN_FORCE_PROPERTY,
    })

    expect(snapshot).toMatchObject({ state: 'enabled', ...NOTICE_2026_09_15 })
    for (const capability of CURRENT_MERCHANT_AI_CAPABILITIES) {
      expect(isAiAuthorizationUnderServedContract(snapshot!, capability)).toBe(true)
    }
  })

  it('leaves a consent under a notice that changed the consent itself lapsed', async () => {
    const snapshot = await authorization.readMerchantAuthorization({
      organizationId: ORGANIZATION_ID,
      propertyId: LAPSED_PROPERTY,
    })

    expect(snapshot).toMatchObject({ state: 'enabled', ...NOTICE_2026_09_09 })
    for (const capability of CURRENT_MERCHANT_AI_CAPABILITIES) {
      expect(isAiAuthorizationUnderServedContract(snapshot!, capability)).toBe(false)
    }
  })
})
