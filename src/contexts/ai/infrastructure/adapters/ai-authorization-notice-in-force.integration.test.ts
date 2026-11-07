// Stored grants retain their recorded capabilities, runtimes and deployment.
// New execution requires a served runtime and a notice still in force for its
// capability; historical evidence alone cannot authorize a retired capability.
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
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { isAiAuthorizationUnderServedContract } from '../../application/ai-workflow-support'
import { createAiAuthorizationAdapter } from './ai-authorization.adapter'

const NOW = new Date('2026-10-30T09:00:00.000Z')
const ORGANIZATION_ID = organizationId('ai-notice-in-force-test-org')
const SERVED = propertyId('74000000-0000-4000-8000-000000000001')
const NOTICE_2026_10_17_PROPERTY = propertyId('74000000-0000-4000-8000-000000000002')
const NOTICE_2026_09_15_PROPERTY = propertyId('74000000-0000-4000-8000-000000000003')
const NOTICE_2026_09_09_PROPERTY = propertyId('74000000-0000-4000-8000-000000000004')
const OLD_PROFILE_PROPERTY = propertyId('74000000-0000-4000-8000-000000000005')

const PROPERTIES = [
  SERVED,
  NOTICE_2026_10_17_PROPERTY,
  NOTICE_2026_09_15_PROPERTY,
  NOTICE_2026_09_09_PROPERTY,
  OLD_PROFILE_PROPERTY,
] as const

/** What a consent recorded before the switch-on holds. */
const BEFORE = {
  profile: 'private-beta-global-v1',
  runtime: {
    review_analysis: 'review-analysis-runtime-v1',
    reply_drafting: 'reply-drafting-runtime-v1',
    property_trends: 'property-trends-runtime-v1',
  },
} as const
/** What a consent recorded since holds. */
const SINCE = {
  profile: 'private-beta-global-v2',
  runtime: {
    review_analysis: 'review-analysis-runtime-v2',
    reply_drafting: 'reply-drafting-runtime-v1',
    property_trends: 'property-trends-runtime-v1',
  },
} as const

const NOTICE_2026_10_17 = {
  noticeVersion: 'merchant-ai-notice-2026-10-17.v1',
  noticeDigest: '2bcd2be15cbb81f324f9a9390ad00baff3ffbb25a6c0db8bff71fbb2b1b0975e',
} as const
const NOTICE_2026_09_15 = {
  noticeVersion: 'merchant-ai-notice-2026-09-15.v1',
  noticeDigest: '6c98ae3bb57b5b142afed1749a1b9f59be8d6ca7edaca3250e39055897289a9c',
} as const
const NOTICE_2026_09_09 = {
  noticeVersion: 'merchant-ai-notice-2026-09-09.v1',
  noticeDigest: 'd80fe3b03f89697cde6c46810053248206aa3745b5f4a5522a24c1c2fdb438e1',
} as const
const SERVED_NOTICE = {
  noticeVersion: MERCHANT_AI_NOTICE_VERSION,
  noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
} as const

const db = getDb()
const authorization = createAiAuthorizationAdapter(db)

/** One enabled head and its evidence row, recorded under `notice` and `held`. */
async function grantUnder(
  property: string,
  lineageId: string,
  notice: Readonly<{ noticeVersion: string; noticeDigest: string }>,
  held: typeof BEFORE | typeof SINCE,
): Promise<void> {
  const contract = {
    organizationId: ORGANIZATION_ID,
    propertyId: property,
    authorizationLineageId: lineageId,
    state: 'enabled',
    capabilities: [...CURRENT_MERCHANT_AI_CAPABILITIES],
    capabilityRuntimeProfileVersions: held.runtime,
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
    providerDeploymentProfileVersion: held.profile,
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

describe('AI authorization after the switch-on (real PostgreSQL)', () => {
  const clear = async () => {
    await db.delete(properties).where(inArray(properties.id, [...PROPERTIES]))
    await deleteTestOrganizations(db, [ORGANIZATION_ID])
  }

  beforeAll(async () => {
    await clear()
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORGANIZATION_ID}, 'AI notice in force test', ${ORGANIZATION_ID}, ${NOW})
    `)
    for (const [index, id] of PROPERTIES.entries()) {
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
    await grantUnder(SERVED, '74000000-0000-4000-8000-000000000011', SERVED_NOTICE, SINCE)
    // What every enabled Property held on the day before the deploy.
    await grantUnder(
      NOTICE_2026_10_17_PROPERTY,
      '74000000-0000-4000-8000-000000000012',
      NOTICE_2026_10_17,
      BEFORE,
    )
    await grantUnder(
      NOTICE_2026_09_15_PROPERTY,
      '74000000-0000-4000-8000-000000000013',
      NOTICE_2026_09_15,
      BEFORE,
    )
    await grantUnder(
      NOTICE_2026_09_09_PROPERTY,
      '74000000-0000-4000-8000-000000000014',
      NOTICE_2026_09_09,
      BEFORE,
    )
    // Recorded deployment evidence does not select the runtime served for new work.
    await grantUnder(
      OLD_PROFILE_PROPERTY,
      '74000000-0000-4000-8000-000000000015',
      SERVED_NOTICE,
      BEFORE,
    )
  })

  afterAll(clear)

  it('serves active capabilities and refuses retired grants under the served notice', async () => {
    const snapshot = await authorization.readMerchantAuthorization({
      organizationId: ORGANIZATION_ID,
      propertyId: SERVED,
    })

    expect(snapshot).toMatchObject({
      state: 'enabled',
      ...SERVED_NOTICE,
      providerDeploymentProfileVersion: 'private-beta-global-v2',
      capabilityRuntimeProfileVersions: { review_analysis: 'review-analysis-runtime-v2' },
      capabilities: [...CURRENT_MERCHANT_AI_CAPABILITIES],
    })
    for (const capability of CURRENT_MERCHANT_AI_CAPABILITIES) {
      expect(isAiAuthorizationUnderServedContract(snapshot!, capability)).toBe(
        capability !== 'property_trends',
      )
    }
  })

  it.each([
    ['2026-10-17', NOTICE_2026_10_17_PROPERTY, NOTICE_2026_10_17],
    ['2026-09-15', NOTICE_2026_09_15_PROPERTY, NOTICE_2026_09_15],
    ['2026-09-09', NOTICE_2026_09_09_PROPERTY, NOTICE_2026_09_09],
  ])(
    'refuses every capability of a consent recorded under the %s notice, which is not in force',
    async (_notice, property, notice) => {
      const snapshot = await authorization.readMerchantAuthorization({
        organizationId: ORGANIZATION_ID,
        propertyId: property,
      })

      // The head is still there and still enabled: nothing rewrote it. It is the
      // contract that no longer admits AI work for it.
      expect(snapshot).toMatchObject({
        state: 'enabled',
        ...notice,
        providerDeploymentProfileVersion: 'private-beta-global-v1',
      })
      for (const capability of CURRENT_MERCHANT_AI_CAPABILITIES) {
        expect(isAiAuthorizationUnderServedContract(snapshot!, capability)).toBe(false)
      }
    },
  )

  it('admits active execution but refuses retired grants despite historical runtime/deployment evidence', async () => {
    const snapshot = await authorization.readMerchantAuthorization({
      organizationId: ORGANIZATION_ID,
      propertyId: OLD_PROFILE_PROPERTY,
    })

    expect(snapshot).toMatchObject({
      ...SERVED_NOTICE,
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      capabilities: [...CURRENT_MERCHANT_AI_CAPABILITIES],
    })
    for (const capability of CURRENT_MERCHANT_AI_CAPABILITIES) {
      expect(isAiAuthorizationUnderServedContract(snapshot!, capability)).toBe(
        capability !== 'property_trends',
      )
    }
  })
})
