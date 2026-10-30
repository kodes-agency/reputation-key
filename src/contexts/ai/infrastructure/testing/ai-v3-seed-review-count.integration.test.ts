// The v3 seed in `adopt` mode, read the way an end-to-end stack reads it (PostgreSQL): Review
// counts the Property's reviews for Guest voice 2.0 from its own source cache, and serves a
// review's words only from a row that holds a location and a retention date. So the seed
// writes the whole row and the cache row beside every review it adds, and the page is drawn
// from reviews Review itself counts and opens. Without them Review counts none (a Property
// with twelve reviews with text is told it has too few to spot patterns), or refuses to
// open them (the page falls back to today's). Every value is invented.
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { getDb, type Database } from '#/shared/db'
import { deleteTestOrganizationsWithExecutor } from '#/shared/db/testing/test-organization-cleanup'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { createReadGuestVoiceV2 } from '../../application/use-cases/read-guest-voice-v2'
import { createEligibleReads } from '#/contexts/review/application/eligible-reads'
import { createReviewRepository } from '#/contexts/review/infrastructure/repositories/review.repository'
import { createAiAuthorizationAdapter } from '../adapters/ai-authorization.adapter'
import { createAiGuestVoiceFactsAdapter } from '../adapters/ai-guest-voice-facts.adapter'
import { createAiPropertyCalendarAdapter } from '../adapters/ai-property-calendar.adapter'
import { createPropertyProcessingProfileAdapter } from '../adapters/property-processing-profile.adapter'
import { createV3Seed, mentionOf, seededReviewId, type SeededReview } from './ai-v3-seed'

const IDS = {
  organizationId: 'ai-v3-seed-count-test-org',
  propertyId: '5ee0d000-0000-4000-8000-000000000001',
  idPrefix: '5ee0d000',
} as const

const DAY_MS = 24 * 60 * 60 * 1000

/** Midday UTC, this many days ago: the same calendar day in New York. */
function daysAgo(days: number): Date {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 16) -
      days * DAY_MS,
  )
}

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

describe.sequential(
  'Guest voice 2.0 over reviews Review itself counts, seeded in adopt mode (PostgreSQL)',
  () => {
    const db: Database = getDb()
    const seed = createV3Seed(db, IDS, {
      adopt: true,
      externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    })
    const reviewsStore = createReviewRepository(db, () => new Date())

    async function removeProperty(): Promise<void> {
      await db.execute(
        sql`DELETE FROM properties WHERE organization_id = ${IDS.organizationId} AND id = ${IDS.propertyId}`,
      )
    }

    beforeAll(async () => {
      await removeProperty()
      await deleteTestOrganizationsWithExecutor(db, [IDS.organizationId])
      await db.execute(sql`
        INSERT INTO organization (id, name, slug, "createdAt")
        VALUES (${IDS.organizationId}, 'Adopted', ${IDS.organizationId}, now())
      `)
      // A Property in the shape an end-to-end spec's `seedProperty` writes.
      await db.execute(sql`
        INSERT INTO properties
          (id, organization_id, name, slug, timezone, country_code, country_source,
           lifecycle_state, source_epoch)
        VALUES (${IDS.propertyId}, ${IDS.organizationId}, 'Adopted property',
                'ai-v3-seed-count-test', 'America/New_York', 'US', 'manual', 'active', 0)
      `)
      await seed.setUp()
      for (const review of REVIEWS) await seed.addReview(review)
      await seed.seal()
    })

    afterAll(async () => {
      await seed.tearDown()
      await removeProperty()
      await deleteTestOrganizationsWithExecutor(db, [IDS.organizationId])
    })

    it('has Review count every seeded review as one with text', async () => {
      const today = daysAgo(0).toISOString().slice(0, 10)
      const result = await reviewsStore.readTrendPopulation({
        organizationId: organizationId(IDS.organizationId),
        propertyId: propertyId(IDS.propertyId),
        sourceEpoch: 0,
        timezone: 'America/New_York',
        calendarProfileVersion: 'property-calendar-v1',
        startLocalDate: daysAgo(30).toISOString().slice(0, 10),
        endLocalDate: today,
        limit: 100,
        detectEvidenceBeforeStart: false,
      })

      if (result.status !== 'complete')
        throw new Error(`expected a count: ${result.status}`)
      expect(result.reviews).toHaveLength(REVIEWS.length)
      expect(result.reviews.every((review) => review.hasText)).toBe(true)
    })

    it('serves every seeded review’s words through Review’s eligible reads', async () => {
      const eligible = createEligibleReads({
        reviewRepo: reviewsStore,
        clock: () => new Date(),
      })

      const snippets = await eligible.getReviewSnippetsByIds(
        REVIEWS.map((review) => reviewId(seededReviewId(IDS, review.index))),
        organizationId(IDS.organizationId),
      )

      expect(snippets.size).toBe(REVIEWS.length)
      expect([...snippets.values()].every((snippet) => snippet.text !== null)).toBe(true)
    })

    it('draws the page from them: the air conditioning first, four reviews', async () => {
      const read = createReadGuestVoiceV2({
        propertyAccess: async () => [],
        authorization: createAiAuthorizationAdapter(db),
        processingProfiles: createPropertyProcessingProfileAdapter(db, () => new Date()),
        calendar: createAiPropertyCalendarAdapter(db),
        facts: createAiGuestVoiceFactsAdapter(db),
        reviewSources: { readTrendPopulation: reviewsStore.readTrendPopulation },
        nowEpochMillis: () => Date.now(),
      })

      const response = await read({
        organizationId: organizationId(IDS.organizationId),
        propertyId: propertyId(IDS.propertyId),
        actor: buildTestAuthContext({
          organizationId: organizationId(IDS.organizationId),
          userId: userId('5ee0d000-0000-4000-8000-0000000000aa'),
          role: 'AccountAdmin',
        }),
        range: 'auto',
      })

      if (response.status !== 'drafted')
        throw new Error(`expected a page: ${response.status}`)
      const page = response.draft.read
      if (page.status !== 'ready')
        throw new Error(`expected a ready page: ${page.status}`)
      expect(page.basis.textReviewCount).toBe(REVIEWS.length)
      expect(
        page.fixFirst.map((item) => [item.title, item.statistics.reviewCount]),
      ).toEqual([['Air conditioning', 4]])
    })
  },
)
