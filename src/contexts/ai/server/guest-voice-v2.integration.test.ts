// Guest voice 2.0 page, read as signed-in members over PostgreSQL with the real
// tenant resolution, execution policy, analysis stores and Inbox reads.

import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/shared/testing/google-provider-identifiers-v1'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  setupServerFunctionHarness,
  type TestMember,
  type TestProperty,
} from '#/shared/testing/server-function-harness'
import { REVIEW_SEED_TABLES } from '#/shared/testing/server-function-review-seeds'
import {
  mentionOf,
  seededReviewId,
  useAiSeeds,
  type SeededReview,
} from './ai-seed.test-fixtures'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)
import { getGuestVoiceV2Fn } from './guest-voice-v2'

const NOW = new Date('2026-10-30T10:00:00Z')
const DAY_MS = 24 * 60 * 60 * 1000
const REVIEW_WORDS = 'Lovely room. The air conditioning broke. Fine.'

const harness = setupServerFunctionHarness({
  clock: () => NOW,
  cleanupTables: REVIEW_SEED_TABLES,
})
const seedAi = useAiSeeds(GOOGLE_LOCATION_PRIMARY_RESOURCE)

// Registered after the seeds' own hook, so it runs first: an Inbox item holds
// the review revision the seed's teardown deletes.
const inboxOrganizations = new Set<string>()
afterEach(async () => {
  await harness
    .pool()
    .query(`DELETE FROM inbox_items WHERE organization_id = ANY($1)`, [
      [...inboxOrganizations],
    ])
  inboxOrganizations.clear()
})

/** Midday UTC, this many days before the harness clock. */
const daysAgo = (days: number) => new Date(Date.UTC(2026, 9, 30, 16) - days * DAY_MS)

const AIR_CONDITIONING = mentionOf({
  topic: 'facilities_equipment',
  polarity: 'negative',
  thing: 'air conditioning',
  issue: 'not working',
  sentences: [2],
})
const BREAKFAST = mentionOf({
  topic: 'food_drink',
  polarity: 'positive',
  thing: 'breakfast',
  issue: 'fresh',
})

/** Twelve reviews with text: four complain of the air conditioning, three praise breakfast. */
const REVIEWS: readonly SeededReview[] = [
  ...[1, 2, 3, 4].map((index): SeededReview => ({
    index,
    rating: 2,
    reviewedAt: daysAgo(index),
    sentiment: 'negative',
    attention: 'high',
    mentions: [AIR_CONDITIONING],
  })),
  ...[5, 6, 7].map((index): SeededReview => ({
    index,
    rating: 5,
    reviewedAt: daysAgo(index),
    sentiment: 'positive',
    mentions: [BREAKFAST],
  })),
  ...[8, 9, 10, 11, 12].map((index): SeededReview => ({
    index,
    rating: 4,
    reviewedAt: daysAgo(index),
    sentiment: 'neutral',
    mentions: [],
  })),
]

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  await harness.grantProperty(manager, property)
  return { organization, admin, manager, property }
}

async function analysedHotel() {
  const scope = await hotel()
  const seed = await seedAi(scope.property)
  await seed.setUp()
  for (const review of REVIEWS) await seed.addReview(review)
  await seed.seal()
  return { ...scope, seed }
}

const readPage = (caller: TestMember | null, property: TestProperty, range = '90d') =>
  harness.callAs(caller, () =>
    getGuestVoiceV2Fn({ data: { propertyId: property.id, range } as never }),
  )

type Page = Awaited<ReturnType<typeof readPage>>

function drafted(page: Page) {
  if (!('fixFirst' in page))
    throw new Error(`expected the drafted page, got ${page.status}`)
  return page
}

describe('getGuestVoiceV2Fn', () => {
  it('answers disabled while AI is not enabled for the Property', async () => {
    const { admin, property } = await hotel()

    expect(await readPage(admin, property)).toEqual({ status: 'disabled' })
  })

  it('answers not_v3 when AI is enabled and no review has a v3 analysis', async () => {
    const { admin, property } = await hotel()
    await (await seedAi(property)).setUp()

    expect(await readPage(admin, property)).toEqual({ status: 'not_v3' })
  })

  it('draws the page of an analysed Property with its statistics', async () => {
    const { admin, property } = await analysedHotel()

    const page = drafted(await readPage(admin, property))

    expect(page.fixFirst).toHaveLength(1)
    expect(page.fixFirst[0]).toMatchObject({
      topic: 'facilities_equipment',
      statistics: { reviewCount: 4 },
    })
  })

  it('reads the automatic window for a bookmark that still says all time', async () => {
    const { admin, property } = await analysedHotel()

    const everything = drafted(await readPage(admin, property, 'all'))
    const automatic = drafted(await readPage(admin, property, 'auto'))

    expect(everything).toEqual(automatic)
  })

  it('quotes the review’s words under the sentence the analysis cited', async () => {
    const { admin, property, seed } = await analysedHotel()
    const cited = seededReviewId(seed.ids, 1)
    await harness
      .pool()
      .query(`UPDATE review_source_contents SET text = $2 WHERE review_id = $1`, [
        cited,
        REVIEW_WORDS,
      ])
    inboxOrganizations.add(property.organizationId)
    const item = await harness.seedInboxItem({
      review: {
        id: cited,
        organizationId: property.organizationId,
        propertyId: property.id,
      },
    })

    const quote = drafted(await readPage(admin, property)).fixFirst[0]?.quote

    expect(quote).toMatchObject({
      inboxItemId: item.id,
      rating: 2,
      text: REVIEW_WORDS,
    })
    expect(
      quote?.sentenceRanges.map(({ start, end }) => quote.text.slice(start, end)),
    ).toEqual(['The air conditioning broke.'])
  })

  it('quotes nothing, and keeps the statistics, for a review with no Inbox item', async () => {
    const { admin, property } = await analysedHotel()

    const card = drafted(await readPage(admin, property)).fixFirst[0]

    expect(card?.quote).toBeNull()
    expect(card?.statistics).toMatchObject({ reviewCount: 4 })
  })

  it('draws the page for a PropertyManager the Property was granted to', async () => {
    const { manager, property } = await analysedHotel()

    expect(drafted(await readPage(manager, property)).fixFirst).toHaveLength(1)
  })

  it('refuses a PropertyManager the Property was not granted to', async () => {
    const { organization, property } = await analysedHotel()
    const outsider = await harness.seedMember(organization, 'PropertyManager')

    await expect(readPage(outsider, property)).rejects.toMatchObject({
      code: 'scope_denied',
      status: 403,
    })
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization, property } = await analysedHotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(readPage(member, property)).rejects.toMatchObject({
      code: 'beta_role_inactive',
    })
  })

  it('refuses a caller with no session', async () => {
    const { property } = await analysedHotel()

    await expect(readPage(null, property)).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
    })
  })

  it('gives an AccountAdmin of another Organization nothing of this Property', async () => {
    const { property } = await analysedHotel()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    expect(await readPage(otherAdmin, property)).toEqual({ status: 'disabled' })
  })

  it('refuses a range it does not know', async () => {
    const { admin, property } = await analysedHotel()

    await expect(readPage(admin, property, 'weekly')).rejects.toThrow(/range/)
  })
})
