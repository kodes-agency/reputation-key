// Guest voice detail drawers, read as signed-in members over PostgreSQL with
// the real tenant resolution, execution policy, analysis stores and Inbox reads.

import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/shared/testing/google-provider-identifiers-v1'
import { randomUUID } from 'node:crypto'
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
import { getGuestVoiceDetailFn } from './guest-voice-details'

const NOW = new Date('2026-10-30T10:00:00Z')
const DAY_MS = 24 * 60 * 60 * 1000
const REVIEW_WORDS = 'Lovely room. The food made me ill. Fine.'
const WINDOW = {
  range: '30d',
  startLocalDate: '2026-10-01',
  endLocalDate: '2026-10-30',
} as const
const AFTER_WINDOW = { ...WINDOW, startLocalDate: '2026-09-01' }

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
const FOOD_SAFETY = mentionOf({
  topic: 'food_drink',
  polarity: 'negative',
  thing: 'food',
  issue: 'made ill',
  sentences: [2],
})

/** Twelve reviews with text, one of them an urgent health concern. */
const REVIEWS: readonly SeededReview[] = [
  ...[1, 2, 3, 4].map((index): SeededReview => ({
    index,
    rating: 2,
    reviewedAt: daysAgo(index),
    sentiment: 'negative',
    attention: 'high',
    mentions: [AIR_CONDITIONING],
  })),
  {
    index: 5,
    rating: 1,
    reviewedAt: daysAgo(5),
    sentiment: 'negative',
    attention: 'urgent',
    urgentReason: 'health',
    mentions: [FOOD_SAFETY],
  },
  ...[6, 7, 8, 9, 10, 11, 12].map((index): SeededReview => ({
    index,
    rating: 4,
    reviewedAt: daysAgo(index),
    sentiment: 'neutral',
    mentions: [],
  })),
]

async function analysedHotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  await harness.grantProperty(manager, property)
  const seed = await seedAi(property)
  await seed.setUp()
  for (const review of REVIEWS) await seed.addReview(review)
  await seed.seal()
  return { organization, admin, manager, property, seed }
}

/** The urgent health concern, filed under the issue its review's complaint belongs to. */
async function healthConcern(property: TestProperty) {
  const { rows } = await harness.pool().query<{ id: string }>(
    `SELECT id FROM ai_property_issue_groups
        WHERE organization_id = $1 AND property_id = $2 AND topic = 'food_drink'`,
    [property.organizationId, property.id],
  )
  return { kind: 'concern', issueId: rows[0]?.id ?? null, reason: 'health' } as const
}

const readDetail = (
  caller: TestMember | null,
  property: TestProperty,
  fields: Readonly<Record<string, unknown>> = {},
) =>
  harness.callAs(caller, async () =>
    getGuestVoiceDetailFn({
      data: {
        propertyId: property.id,
        ...WINDOW,
        target: await healthConcern(property),
        ...fields,
      } as never,
    }),
  )

function concernDrawer(page: Awaited<ReturnType<typeof readDetail>>) {
  if (page.status !== 'ready' || page.drawer.kind !== 'concern') {
    throw new Error(`expected the concern drawer, got ${page.status}`)
  }
  return page.drawer
}

describe('getGuestVoiceDetailFn', () => {
  it('answers disabled while AI is not enabled for the Property', async () => {
    const organization = await harness.seedOrganization()
    const admin = await harness.seedMember(organization, 'AccountAdmin')
    const property = await harness.seedProperty(organization)

    expect(await readDetail(admin, property)).toEqual({ status: 'disabled' })
  })

  it('asks for a refresh when the window is not the one the page draws', async () => {
    const { admin, property } = await analysedHotel()

    expect(await readDetail(admin, property, AFTER_WINDOW)).toEqual({
      status: 'refresh_required',
    })
  })

  it('answers not found for an issue the Property does not have', async () => {
    const { admin, property } = await analysedHotel()

    const page = await readDetail(admin, property, {
      target: { kind: 'issue', issueId: randomUUID(), sense: 'complaint' },
    })

    expect(page).toEqual({ status: 'not_found' })
  })

  it('draws the concern with the review’s words, under the sentence the analysis cited', async () => {
    const { admin, property, seed } = await analysedHotel()
    const cited = seededReviewId(seed.ids, 5)
    await harness
      .pool()
      .query(`UPDATE review_source_contents SET text = $2 WHERE review_id = $1`, [
        cited,
        REVIEW_WORDS,
      ])
    inboxOrganizations.add(property.organizationId)
    await harness.seedInboxItem({
      review: {
        id: cited,
        organizationId: property.organizationId,
        propertyId: property.id,
      },
    })

    const drawer = concernDrawer(await readDetail(admin, property))

    expect(drawer.reviewCount).toBe(1)
    const [evidence] = drawer.liveEvidence
    expect(evidence?.text).toBe(REVIEW_WORDS)
    expect(
      evidence?.sentenceRanges.map(({ start, end }) => evidence.text.slice(start, end)),
    ).toEqual(['The food made me ill.'])
  })

  it('draws the concern without words for a review with no Inbox item', async () => {
    const { admin, property } = await analysedHotel()

    const drawer = concernDrawer(await readDetail(admin, property))

    expect(drawer).toMatchObject({ reviewCount: 1, liveEvidence: [] })
  })

  it('reads for a PropertyManager the Property was granted to', async () => {
    const { manager, property } = await analysedHotel()

    expect(concernDrawer(await readDetail(manager, property)).reviewCount).toBe(1)
  })

  it('refuses a PropertyManager the Property was not granted to', async () => {
    const { organization, property } = await analysedHotel()
    const outsider = await harness.seedMember(organization, 'PropertyManager')

    await expect(readDetail(outsider, property)).rejects.toMatchObject({
      code: 'scope_denied',
      status: 403,
    })
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization, property } = await analysedHotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(readDetail(member, property)).rejects.toMatchObject({
      code: 'beta_role_inactive',
    })
  })

  it('refuses a caller with no session', async () => {
    const { property } = await analysedHotel()

    await expect(readDetail(null, property)).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
    })
  })

  it('gives an AccountAdmin of another Organization nothing of this Property', async () => {
    const { property } = await analysedHotel()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    expect(await readDetail(otherAdmin, property)).toEqual({ status: 'disabled' })
  })

  it.each([
    [
      'an Organization id',
      { organizationId: 'org-1' },
      /Unrecognized key|unrecognized_keys/,
    ],
    ['an impossible date', { startLocalDate: '2026-02-30' }, /startLocalDate/],
    [
      'a malformed issue id',
      { target: { kind: 'issue', issueId: 'bad', sense: 'praise' } },
      /issueId/,
    ],
    ['an unknown target', { target: { kind: 'room' } }, /target/],
  ])('refuses %s', async (_name, fields, message) => {
    const { admin, property } = await analysedHotel()

    await expect(readDetail(admin, property, fields)).rejects.toThrow(message)
  })
})
