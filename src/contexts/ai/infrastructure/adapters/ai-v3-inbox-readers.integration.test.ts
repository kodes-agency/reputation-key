// What the Inbox's analysis filters answer for a Property whose reviews carry only a v3
// analysis (real PostgreSQL), after the switch-on. An old link or bookmark carries the v2
// vocabulary (`?aspect=cleanliness&polarity=negative`); a v3 analysis has mentions and
// issues, not aspects, so the filter finds nothing, and nothing throws: the Inbox shows an
// empty list that can be cleared, not an error page. The v3 vocabulary (`issue`) finds
// the reviews. Every row is invented.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb, type Database } from '#/shared/db'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { ASPECT_TAXONOMY_V1 } from '#/shared/aspect-taxonomy'
import { createAiOutputStoreAdapter } from './ai-output-store.adapter'
import { findCurrentReviewIdsByIssue } from './ai-current-issue-review-ids'
import { createAiGuestVoiceFactsAdapter } from './ai-guest-voice-facts.adapter'
import {
  createV3Seed,
  mentionOf,
  seededReviewId,
  type SeededReview,
} from '../testing/ai-v3-seed'

const IDS = {
  organizationId: 'ai-v3-inbox-readers-test-org',
  propertyId: '7a000000-0000-4000-8000-000000000001',
  idPrefix: '7a000000',
} as const

/** The day the Inbox is read, a few days after the last seeded review. */
const NOW = Date.UTC(2026, 9, 20, 12)

const NOON = (day: number) => new Date(Date.UTC(2026, 9, day, 16, 0, 0))

const AIR_CONDITIONING = {
  topic: 'facilities_equipment',
  polarity: 'negative',
  thing: 'air conditioning',
  issue: 'not working',
} as const

const REVIEWS: readonly SeededReview[] = [
  {
    index: 1,
    rating: 2,
    reviewedAt: NOON(9),
    sentiment: 'negative',
    mentions: [mentionOf(AIR_CONDITIONING)],
  },
  {
    index: 2,
    rating: 2,
    reviewedAt: NOON(10),
    sentiment: 'negative',
    mentions: [mentionOf(AIR_CONDITIONING)],
  },
  {
    index: 3,
    rating: 5,
    reviewedAt: NOON(11),
    sentiment: 'positive',
    mentions: [mentionOf({ topic: 'staff_service', polarity: 'positive' })],
  },
]

describe.sequential('the Inbox filters over a v3-only Property (PostgreSQL)', () => {
  const db: Database = getDb()
  const seed = createV3Seed(db, IDS)
  const outputs = createAiOutputStoreAdapter(db)
  const facts = createAiGuestVoiceFactsAdapter(db)
  const base = {
    organizationId: organizationId(IDS.organizationId),
    propertyIds: [propertyId(IDS.propertyId)],
    nowEpochMillis: NOW,
  }

  beforeAll(async () => {
    await seed.setUp()
    for (const review of REVIEWS) await seed.addReview(review)
    await seed.seal()
  })

  afterAll(async () => {
    await seed.tearDown()
  })

  it.each(ASPECT_TAXONOMY_V1)(
    'finds nothing, and does not throw, for an old link naming the %s aspect',
    async (aspect) => {
      await expect(
        outputs.findCurrentReviewIdsByAspect({
          ...base,
          aspects: [aspect],
          polarities: ['negative'],
        }),
      ).resolves.toEqual([])
    },
  )

  it('finds nothing, and does not throw, for an old link naming only a polarity', async () => {
    await expect(
      outputs.findCurrentReviewIdsByAspect({ ...base, polarities: ['negative'] }),
    ).resolves.toEqual([])
  })

  it('finds the reviews that complain of an issue by the v3 vocabulary', async () => {
    const read = await facts.readFacts(seed.scope, {
      startLocalDate: '2026-10-01',
      endLocalDate: '2026-10-31',
    })
    const issueId = read?.reviews[0]?.mentions[0]?.issueGroupId
    if (issueId === undefined || issueId === null) {
      throw new Error('The seeded air conditioning mention belongs to an issue')
    }

    const complaining = await findCurrentReviewIdsByIssue(db, {
      ...base,
      issueId,
      polarities: ['negative'],
    })
    const praising = await findCurrentReviewIdsByIssue(db, {
      ...base,
      issueId,
      polarities: ['positive'],
    })

    expect([...complaining].sort()).toEqual(
      [seededReviewId(IDS, 1), seededReviewId(IDS, 2)].sort(),
    )
    expect(praising).toEqual([])
  })
})
