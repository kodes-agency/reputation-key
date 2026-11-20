// Merchant AI consent server functions, called as signed-in members over
// PostgreSQL with the real tenant resolution, execution policy and consent
// store. Only an AccountAdmin manages AI; every write is fenced by the state
// version the previous read or write answered.

import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import {
  setupServerFunctionHarness,
  type TestMember,
  type TestProperty,
} from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import {
  changeMerchantAiCapabilitiesFn,
  deferMerchantAiDecisionFn,
  enableMerchantAiForPropertiesFn,
  enableMerchantAiFn,
  getMerchantAiAuthorizationFn,
  listMerchantAiOverviewFn,
  revokeMerchantAiFn,
} from './merchant-ai'

const harness = setupServerFunctionHarness()

const ACKNOWLEDGEMENT = {
  noticeVersion: MERCHANT_AI_NOTICE_VERSION,
  noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
}

const key = () => `request-${randomUUID()}`

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization, { google: true })
  await harness.grantProperty(manager, property)
  return { organization, admin, manager, property }
}

function read(member: TestMember, property: TestProperty) {
  return harness.callAs(member, () =>
    getMerchantAiAuthorizationFn({ data: { propertyId: property.id } }),
  )
}

function enable(member: TestMember, property: TestProperty, expectedStateVersion = 0) {
  return harness.callAs(member, () =>
    enableMerchantAiFn({
      data: {
        propertyId: property.id,
        idempotencyKey: key(),
        expectedStateVersion,
        acknowledgement: ACKNOWLEDGEMENT,
      },
    }),
  )
}

describe('Merchant AI authorization reads', () => {
  it("reads the Property's authorization and the notice in force for an AccountAdmin", async () => {
    const { admin, property } = await hotel()

    const answer = await read(admin, property)

    expect(answer.authorization).toMatchObject({
      organizationId: admin.organizationId,
      propertyId: property.id,
      state: 'disabled',
      stateVersion: 0,
    })
    expect(answer.notice).toMatchObject({ version: MERCHANT_AI_NOTICE_VERSION })
  })

  it('serves the notice alone when no Property is named', async () => {
    const { admin } = await hotel()

    const answer = await harness.callAs(admin, () =>
      getMerchantAiAuthorizationFn({ data: {} }),
    )

    expect(answer).toEqual({
      authorization: null,
      notice: expect.objectContaining({ version: MERCHANT_AI_NOTICE_VERSION }),
    })
  })

  it('refuses a PropertyManager granted the Property and a request with no session', async () => {
    const { manager, property } = await hotel()

    await expect(read(manager, property)).rejects.toMatchObject({ status: 403 })
    await expect(
      harness.callAs(null, () =>
        getMerchantAiAuthorizationFn({ data: { propertyId: property.id } }),
      ),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })
})

describe('Merchant AI consent commands', () => {
  it('enables on the served notice, changes capabilities and revokes without an acknowledgement', async () => {
    const { admin, property } = await hotel()

    const enabled = await enable(admin, property)
    expect(enabled).toMatchObject({ state: 'enabled', stateVersion: 1 })

    const changed = await harness.callAs(admin, () =>
      changeMerchantAiCapabilitiesFn({
        data: {
          propertyId: property.id,
          idempotencyKey: key(),
          expectedStateVersion: enabled.stateVersion,
          acknowledgement: ACKNOWLEDGEMENT,
          capabilities: ['review_analysis'],
        },
      }),
    )
    expect(changed).toMatchObject({
      state: 'enabled',
      stateVersion: 2,
      capabilities: ['review_analysis'],
    })

    const revoked = await harness.callAs(admin, () =>
      revokeMerchantAiFn({
        data: {
          propertyId: property.id,
          idempotencyKey: key(),
          expectedStateVersion: changed.stateVersion,
        },
      }),
    )
    expect(revoked).toMatchObject({ state: 'revoked', stateVersion: 3 })
    expect((await read(admin, property)).authorization).toMatchObject({
      state: 'revoked',
      stateVersion: 3,
    })
    const { rows } = await harness.pool().query(
      `SELECT state_version, reason_code, actor_user_id
         FROM merchant_ai_consent_evidence WHERE property_id = $1
        ORDER BY state_version`,
      [property.id],
    )
    expect(rows).toEqual([
      { state_version: 1, reason_code: 'merchant_enabled', actor_user_id: admin.userId },
      {
        state_version: 2,
        reason_code: 'capabilities_changed',
        actor_user_id: admin.userId,
      },
      { state_version: 3, reason_code: 'merchant_revoked', actor_user_id: admin.userId },
    ])
  })

  it('reports a stale notice acknowledgement as a conflict to reload', async () => {
    const { admin, property } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        enableMerchantAiFn({
          data: {
            propertyId: property.id,
            idempotencyKey: key(),
            expectedStateVersion: 0,
            acknowledgement: { ...ACKNOWLEDGEMENT, noticeDigest: 'a'.repeat(64) },
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'notice_mismatch', status: 409 })
    expect((await read(admin, property)).authorization).toMatchObject({
      state: 'disabled',
    })
  })

  it('refuses a write fenced by a stale state version', async () => {
    const { admin, property } = await hotel()
    await enable(admin, property)

    await expect(
      harness.callAs(admin, () =>
        revokeMerchantAiFn({
          data: {
            propertyId: property.id,
            idempotencyKey: key(),
            expectedStateVersion: 0,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'version_conflict', status: 409 })
  })

  it('stops a PropertyManager at the execution gate before anything changes', async () => {
    const { admin, manager, property } = await hotel()
    const enabled = await harness.seedMerchantAiConsent(property, { actor: admin })

    await expect(
      harness.callAs(manager, () =>
        changeMerchantAiCapabilitiesFn({
          data: {
            propertyId: property.id,
            idempotencyKey: key(),
            expectedStateVersion: enabled.stateVersion,
            acknowledgement: ACKNOWLEDGEMENT,
            capabilities: ['review_analysis'],
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 })
    expect((await read(admin, property)).authorization).toMatchObject({
      stateVersion: enabled.stateVersion,
    })
  })

  it("refuses another Organization's Property", async () => {
    const { admin } = await hotel()
    const elsewhere = await hotel()

    await expect(enable(admin, elsewhere.property)).rejects.toMatchObject({
      code: 'property_inactive',
      status: 400,
    })
    expect((await read(elsewhere.admin, elsewhere.property)).authorization).toMatchObject(
      { state: 'disabled' },
    )
  })
})

describe('Merchant AI decision deferral', () => {
  it('records "not now" for the AccountAdmin', async () => {
    const { admin, property } = await hotel()

    const deferred = await harness.callAs(admin, () =>
      deferMerchantAiDecisionFn({ data: { propertyId: property.id } }),
    )

    expect(deferred).toEqual({
      propertyId: property.id,
      decisionDeferredAt: expect.any(String),
    })
    expect((await read(admin, property)).authorization).toMatchObject({
      decisionDeferredAt: deferred.decisionDeferredAt,
    })
  })

  it('answers an already-enabled Property with a conflict', async () => {
    const { admin, property } = await hotel()
    await harness.seedMerchantAiConsent(property, { actor: admin })

    await expect(
      harness.callAs(admin, () =>
        deferMerchantAiDecisionFn({ data: { propertyId: property.id } }),
      ),
    ).rejects.toMatchObject({
      name: 'MerchantAiDecisionError',
      code: 'already_enabled',
      status: 409,
    })
  })

  it('answers a Property that does not exist with not found', async () => {
    const { admin } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        deferMerchantAiDecisionFn({ data: { propertyId: randomUUID() } }),
      ),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('does not defer for a PropertyManager', async () => {
    const { admin, manager, property } = await hotel()

    await expect(
      harness.callAs(manager, () =>
        deferMerchantAiDecisionFn({ data: { propertyId: property.id } }),
      ),
    ).rejects.toMatchObject({ status: 403 })
    expect((await read(admin, property)).authorization).toMatchObject({
      decisionDeferredAt: null,
    })
  })
})

describe('Merchant AI overview', () => {
  it("lists the Organization's Properties for the AccountAdmin", async () => {
    const { admin, property } = await hotel()
    await harness.seedMerchantAiConsent(property, { actor: admin })

    const overview = await harness.callAs(admin, () => listMerchantAiOverviewFn())

    expect(overview.properties).toEqual([
      expect.objectContaining({ propertyId: property.id }),
    ])
  })

  it('does not read the overview for a PropertyManager', async () => {
    const { manager } = await hotel()

    await expect(
      harness.callAs(manager, () => listMerchantAiOverviewFn()),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('Merchant AI consent ceremony', () => {
  it('enables every named Property under one ceremony', async () => {
    const { organization, admin, property } = await hotel()
    const second = await harness.seedProperty(organization, { google: true })

    await harness.callAs(admin, () =>
      enableMerchantAiForPropertiesFn({
        data: {
          propertyIds: [property.id, second.id],
          capabilities: ['review_analysis', 'reply_drafting'],
          acknowledgement: ACKNOWLEDGEMENT,
          idempotencyKey: key(),
        },
      }),
    )

    for (const each of [property, second]) {
      expect((await read(admin, each)).authorization).toMatchObject({
        state: 'enabled',
        capabilities: ['review_analysis', 'reply_drafting'],
      })
    }
  })

  it("enables none of a ceremony's Properties when one is refused", async () => {
    const { admin, property } = await hotel()
    const elsewhere = await hotel()

    await expect(
      harness.callAs(admin, () =>
        enableMerchantAiForPropertiesFn({
          data: {
            propertyIds: [property.id, elsewhere.property.id],
            capabilities: ['review_analysis'],
            acknowledgement: ACKNOWLEDGEMENT,
            idempotencyKey: key(),
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'property_inactive', status: 400 })
    expect((await read(admin, property)).authorization).toMatchObject({
      state: 'disabled',
    })
  })

  it('stops a ceremony at the execution gate for a PropertyManager', async () => {
    const { admin, manager, property } = await hotel()

    await expect(
      harness.callAs(manager, () =>
        enableMerchantAiForPropertiesFn({
          data: {
            propertyIds: [property.id],
            capabilities: ['review_analysis'],
            acknowledgement: ACKNOWLEDGEMENT,
            idempotencyKey: key(),
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 })
    expect((await read(admin, property)).authorization).toMatchObject({
      state: 'disabled',
    })
  })
})
