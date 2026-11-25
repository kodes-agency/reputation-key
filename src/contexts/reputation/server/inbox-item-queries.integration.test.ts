// The Inbox item detail server function, called as signed-in members over
// PostgreSQL with the real tenant resolution, execution policy, Inbox API and
// merchant AI consent. It holds the boundary: who may read an item, whether
// reply drafting is offered for it, and the reply frame read back as stored.

import { describe, expect, it, vi } from 'vitest'
import {
  setupServerFunctionHarness,
  type TestMember,
} from '#/shared/testing/server-function-harness'
import { GOAL_CLEANUP_TABLES } from '#/shared/testing/server-function-goal-seeds'
import { REVIEW_SEED_TABLES } from '#/shared/testing/server-function-review-seeds'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { revokeMerchantAiFn } from '#/contexts/identity/server/merchant-ai'
import { getInboxItemDetailFn } from './inbox-item-queries'

const harness = setupServerFunctionHarness({
  cleanupTables: [...REVIEW_SEED_TABLES, ...GOAL_CLEANUP_TABLES],
})

async function hotel(options: { google?: boolean } = {}) {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization, {
    google: options.google ?? false,
  })
  await harness.grantProperty(manager, property)
  const review = await harness.seedReview(property)
  const item = await harness.seedInboxItem({ review })
  return { organization, admin, manager, property, review, item }
}

function detail(member: TestMember | null, itemId: string) {
  return harness.callAs(member, () =>
    getInboxItemDetailFn({ data: { inboxItemId: itemId } }),
  )
}

async function withDraftingConsent() {
  const hotelRows = await hotel({ google: true })
  await harness.seedMerchantAiConsent(hotelRows.property, { actor: hotelRows.admin })
  return hotelRows
}

async function storeAiReply(
  review: { id: string },
  text: string,
  choices: Record<string, unknown>,
) {
  await harness.pool().query(
    `UPDATE replies SET ai_generated = true, voice_digest = $2, voice_choices = $3, text = $4
      WHERE review_id = $1`,
    [review.id, 'a'.repeat(64), JSON.stringify(choices), text],
  )
}

describe('getInboxItemDetailFn', () => {
  it('is a GET', () => {
    expect(getInboxItemDetailFn).toHaveProperty('method', 'GET')
  })

  it('offers reply drafting to an AccountAdmin when the Property has current AI consent', async () => {
    const { admin, item } = await withDraftingConsent()

    const read = await detail(admin, item.id)

    expect(read.item.id).toBe(item.id)
    expect(read.replyDraftingAvailable).toBe(true)
  })

  it('offers reply drafting to a PropertyManager the Property was granted to', async () => {
    const { manager, item } = await withDraftingConsent()

    expect((await detail(manager, item.id)).replyDraftingAvailable).toBe(true)
  })

  it('stops offering reply drafting once the consent is withdrawn', async () => {
    const { admin, property, item } = await withDraftingConsent()

    await harness.callAs(admin, () =>
      revokeMerchantAiFn({
        data: {
          propertyId: property.id,
          idempotencyKey: 'revoke-harness-1',
          expectedStateVersion: 1,
        },
      }),
    )

    expect((await detail(admin, item.id)).replyDraftingAvailable).toBe(false)
  })

  it('does not offer reply drafting for a Property that never gave AI consent', async () => {
    const { admin, item } = await hotel({ google: true })

    expect((await detail(admin, item.id)).replyDraftingAvailable).toBe(false)
  })

  it('does not offer reply drafting for a suspended Property, whatever its consent', async () => {
    const { admin, property, item } = await withDraftingConsent()
    await harness
      .pool()
      .query(`UPDATE properties SET lifecycle_state = 'suspended' WHERE id = $1`, [
        property.id,
      ])

    expect((await detail(admin, item.id)).replyDraftingAvailable).toBe(false)
  })

  it('reads the frame from the lengths stored with the AI reply, whatever the voice says now', async () => {
    const { admin, review, item } = await withDraftingConsent()
    await harness.seedReply(review, { status: 'draft' })
    const prefix = 'Hello Anna,'
    const suffix = 'Kind regards, Our team'
    await storeAiReply(review, `${prefix}\n\nA short body.\n\n${suffix}`, {
      closing: 0,
      signOff: 0,
      contactSentence: 0,
      emoji: 0,
      includeContact: true,
      bodyPrefixLength: prefix.length,
      bodySuffixLength: suffix.length,
    })

    expect((await detail(admin, item.id)).replyBodyFrame).toEqual({ prefix, suffix })
  })

  it('has no frame for a reply a person wrote', async () => {
    const { admin, review, item } = await hotel()
    await harness.seedReply(review, { status: 'draft' })

    expect((await detail(admin, item.id)).replyBodyFrame).toBeNull()
  })

  it('refuses a PropertyManager the Property was not granted to', async () => {
    const { organization, item } = await hotel()
    const outsider = await harness.seedMember(organization, 'PropertyManager')

    await expect(detail(outsider, item.id)).rejects.toMatchObject({ status: 403 })
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization, item } = await hotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(detail(member, item.id)).rejects.toMatchObject({
      code: 'beta_role_inactive',
    })
  })

  it('does not find the item for an AccountAdmin of another Organization', async () => {
    const { item } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(detail(otherAdmin, item.id)).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
    })
  })

  it('refuses a caller with no session', async () => {
    const { item } = await hotel()

    await expect(detail(null, item.id)).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
    })
  })

  it('refuses an item id that is not a UUID before reading anything', async () => {
    const { admin } = await hotel()

    await expect(detail(admin, 'item-1')).rejects.toThrow(/inboxItemId/)
  })
})
