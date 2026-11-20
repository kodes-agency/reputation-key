// The "AI update" announcement server functions, called as signed-in members
// over PostgreSQL with the real tenant resolution and execution policy. A
// standing renewal the worker applied is announced once to each AccountAdmin;
// seeing it is recorded per person.

import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import {
  setupServerFunctionHarness,
  type TestMember,
  type TestOrganization,
} from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import {
  getMerchantAiNoticeUpdateFn,
  markMerchantAiNoticeUpdateSeenFn,
} from './merchant-ai-notice-updates'

const harness = setupServerFunctionHarness()

const RENEWED = {
  noticeVersion: MERCHANT_AI_NOTICE_VERSION,
  noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
}

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization, { google: true })
  await harness.grantProperty(manager, property)
  return { organization, admin, manager, property }
}

/** The worker applied a standing renewal to the Organization's Property. */
async function renewed(
  organization: TestOrganization,
  admin: TestMember,
  property: Parameters<typeof harness.seedMerchantAiConsent>[0],
) {
  await harness.seedMerchantAiConsent(property, { actor: admin })
  const client = await harness.pool().connect()
  try {
    await client.query('BEGIN')
    // The consent history is append-only outside the transition the app opens.
    await client.query(`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
    await client.query(
      `INSERT INTO merchant_ai_consent_evidence
       (authorization_lineage_id, state_version, organization_id, property_id,
        transition_kind, state, capabilities, capability_runtime_profile_versions,
        review_analysis_epoch, reply_drafting_epoch, property_trends_epoch,
        authorized_source_epoch, analysis_start_sequence, notice_version, notice_digest,
        source_policy_id, routing_policy_version, processing_region,
        provider_deployment_profile_version, redaction_profile_family, actor_user_id,
        reason_code, idempotency_key, request_hash, occurred_at, ceremony_id)
     SELECT authorization_lineage_id, state_version + 1, organization_id, property_id,
        'change', state, capabilities, capability_runtime_profile_versions,
        review_analysis_epoch, reply_drafting_epoch, property_trends_epoch,
        authorized_source_epoch, analysis_start_sequence, notice_version, notice_digest,
        source_policy_id, routing_policy_version, processing_region,
        provider_deployment_profile_version, redaction_profile_family, actor_user_id,
        'standing_renewal', $2, request_hash, now(), NULL
       FROM merchant_ai_consent_evidence WHERE organization_id = $1
      ORDER BY state_version DESC LIMIT 1`,
      [organization.id, randomUUID()],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const receipts = async (organizationId: string) =>
  (
    await harness.pool().query(
      `SELECT user_id, notice_version FROM merchant_ai_notice_update_receipts
          WHERE organization_id = $1`,
      [organizationId],
    )
  ).rows

describe('getMerchantAiNoticeUpdateFn', () => {
  it('answers an AccountAdmin with nothing when no renewal was applied', async () => {
    const { admin } = await hotel()

    const update = await harness.callAs(admin, () => getMerchantAiNoticeUpdateFn())

    expect(update).toBeNull()
  })

  it('announces an applied renewal to an AccountAdmin of its Organization', async () => {
    const { organization, admin, property } = await hotel()
    await renewed(organization, admin, property)

    const update = await harness.callAs(admin, () => getMerchantAiNoticeUpdateFn())

    expect(update).toMatchObject({
      noticeVersion: RENEWED.noticeVersion,
      noticeDigest: RENEWED.noticeDigest,
      title: 'Property Trends retired',
    })
  })

  it("does not show another Organization's renewal", async () => {
    const { organization, admin, property } = await hotel()
    await renewed(organization, admin, property)
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    const update = await harness.callAs(otherAdmin, () => getMerchantAiNoticeUpdateFn())

    expect(update).toBeNull()
  })

  it('refuses a PropertyManager', async () => {
    const { manager } = await hotel()

    await expect(
      harness.callAs(manager, () => getMerchantAiNoticeUpdateFn()),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('refuses a caller with no session', async () => {
    await expect(
      harness.callAs(null, () => getMerchantAiNoticeUpdateFn()),
    ).rejects.toMatchObject({ status: 401 })
  })
})

describe('markMerchantAiNoticeUpdateSeenFn', () => {
  it('records the receipt for the caller, who then no longer sees the announcement', async () => {
    const { organization, admin, property } = await hotel()
    await renewed(organization, admin, property)

    await harness.callAs(admin, () => markMerchantAiNoticeUpdateSeenFn({ data: RENEWED }))

    expect(await receipts(organization.id)).toEqual([
      { user_id: admin.userId, notice_version: RENEWED.noticeVersion },
    ])
    expect(await harness.callAs(admin, () => getMerchantAiNoticeUpdateFn())).toBeNull()
  })

  it('keeps the announcement for a second AccountAdmin who has not seen it', async () => {
    const { organization, admin, property } = await hotel()
    const second = await harness.seedMember(organization, 'AccountAdmin')
    await renewed(organization, admin, property)

    await harness.callAs(admin, () => markMerchantAiNoticeUpdateSeenFn({ data: RENEWED }))

    expect(
      await harness.callAs(second, () => getMerchantAiNoticeUpdateFn()),
    ).toMatchObject({ noticeVersion: RENEWED.noticeVersion })
  })

  it('writes no receipt for a notice that was never applied', async () => {
    const { organization, admin, property } = await hotel()
    await renewed(organization, admin, property)

    await harness.callAs(admin, () =>
      markMerchantAiNoticeUpdateSeenFn({
        data: {
          noticeVersion: 'merchant-ai-notice-2099-01-01.v1',
          noticeDigest: 'c'.repeat(64),
        },
      }),
    )

    expect(await receipts(organization.id)).toEqual([])
  })

  it('refuses a PropertyManager and writes nothing', async () => {
    const { organization, admin, manager, property } = await hotel()
    await renewed(organization, admin, property)

    await expect(
      harness.callAs(manager, () => markMerchantAiNoticeUpdateSeenFn({ data: RENEWED })),
    ).rejects.toMatchObject({ status: 403 })
    expect(await receipts(organization.id)).toEqual([])
  })

  it('refuses a digest that is not 64 hex characters', async () => {
    const { admin } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        markMerchantAiNoticeUpdateSeenFn({
          data: { noticeVersion: RENEWED.noticeVersion, noticeDigest: 'short' },
        }),
      ),
    ).rejects.toThrow(/noticeDigest/)
  })
})
