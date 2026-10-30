// A name the analysis found stays in the review whatever a manager does to the topic that
// carried it (PostgreSQL). Setting a mention aside takes it out of the Guest voice counts,
// not the name out of the guest's words, so the review must stay out of every quote. Every
// row is invented: ids, stars, topics and the numbers of sentences.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb, type Database } from '#/shared/db'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { pickEvidenceCandidates } from '../../application/read-models/guest-voice-v2-evidence'
import type { MentionCorrectionAnalysisKey } from '../../application/ports/ai-mention-correction-store.port'
import { createAiGuestVoiceFactsAdapter } from './ai-guest-voice-facts.adapter'
import { createAiMentionCorrectionStoreAdapter } from './ai-mention-correction-store.adapter'
import {
  createV3Seed,
  mentionOf,
  seededReviewId,
  type SeededReview,
} from '../testing/ai-v3-seed'

const IDS = {
  organizationId: 'ai-gv2-names-test-org',
  propertyId: '7d000000-0000-4000-8000-000000000001',
  idPrefix: '7d000000',
} as const
const PERIOD = { startLocalDate: '2026-10-01', endLocalDate: '2026-10-31' } as const
const REVIEWED_AT = new Date(Date.UTC(2026, 9, 12, 16, 0, 0))
const FENCES = { reviewAnalysisEpoch: 1, propertyProfileVersion: 1 } as const

const AIR_CONDITIONING = mentionOf({
  topic: 'facilities_equipment',
  polarity: 'negative',
  thing: 'air conditioning',
  issue: 'not working',
  sentences: [2],
})
const STAFF_BY_NAME = mentionOf({
  topic: 'staff_service',
  polarity: 'positive',
  sentences: [1],
  namesPerson: 'team_member',
})

/** Review 1 praises a team member by name and complains of the air conditioning; review 2 only complains. */
const REVIEWS: readonly SeededReview[] = [
  {
    index: 1,
    rating: 2,
    reviewedAt: REVIEWED_AT,
    sentiment: 'mixed',
    attention: 'high',
    mentions: [STAFF_BY_NAME, AIR_CONDITIONING],
  },
  {
    index: 2,
    rating: 2,
    reviewedAt: REVIEWED_AT,
    sentiment: 'negative',
    attention: 'high',
    mentions: [AIR_CONDITIONING],
  },
]

function keyOf(index: number): MentionCorrectionAnalysisKey {
  return {
    organizationId: organizationId(IDS.organizationId),
    propertyId: propertyId(IDS.propertyId),
    reviewId: reviewId(seededReviewId(IDS, index)),
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: index,
  }
}

describe.sequential(
  'a name in a review after a manager sets its mention aside (PostgreSQL)',
  () => {
    const db: Database = getDb()
    const seed = createV3Seed(db, IDS)
    const facts = createAiGuestVoiceFactsAdapter(db)
    const corrections = createAiMentionCorrectionStoreAdapter(db)

    async function readReviews() {
      const read = await facts.readFacts(seed.scope, PERIOD)
      if (read === null) throw new Error('expected the Property’s facts')
      return read
    }

    const reviewIdsOffered = async () => {
      const read = await readReviews()
      const group = read.groups.find(
        (candidate) => candidate.canonicalThing === 'air conditioning',
      )
      if (group === undefined) throw new Error('the seed has no such issue')
      return pickEvidenceCandidates(read.reviews, group.id, 'complaint').map(
        (candidate) => candidate.reviewId,
      )
    }

    beforeAll(async () => {
      await seed.setUp()
      for (const review of REVIEWS) await seed.addReview(review)
      await seed.seal()
    })

    afterAll(async () => {
      await seed.tearDown()
    })

    it('flags the review whose answer names a person, and only that one', async () => {
      const { reviews } = await readReviews()

      expect(reviews.map((review) => [review.reviewId, review.namesAPerson])).toEqual([
        [seededReviewId(IDS, 1), true],
        [seededReviewId(IDS, 2), false],
      ])
      // The named review is not offered as a quote for the other problem it states.
      await expect(reviewIdsOffered()).resolves.toEqual([seededReviewId(IDS, 2)])
    })

    it('keeps the flag, and the review out of the quotes, when the named mention is removed', async () => {
      await expect(
        corrections.apply({
          key: keyOf(1),
          fences: FENCES,
          mentionOrdinal: 0,
          command: { kind: 'remove_topic' },
          correctedBy: 'a-manager',
          correctedAt: new Date('2026-10-30T12:00:00.000Z'),
        }),
      ).resolves.toEqual({ status: 'applied', mentionOrdinals: [0] })

      const { reviews } = await readReviews()
      const first = reviews.find((review) => review.reviewId === seededReviewId(IDS, 1))
      // The counts no longer have the staff mention...
      expect(first?.mentions.map((mention) => mention.topic)).toEqual([
        'facilities_equipment',
      ])
      expect(first?.mentions.every((mention) => mention.namesPerson === null)).toBe(true)
      // ...but the name is still in the review, so it is still not quotable.
      expect(first?.namesAPerson).toBe(true)
      await expect(reviewIdsOffered()).resolves.toEqual([seededReviewId(IDS, 2)])
    })

    it('is the same once the correction is taken away', async () => {
      await expect(
        corrections.clear({ key: keyOf(1), fences: FENCES, mentionOrdinal: 0 }),
      ).resolves.toEqual({ status: 'cleared', mentionOrdinals: [0] })

      const { reviews } = await readReviews()
      const first = reviews.find((review) => review.reviewId === seededReviewId(IDS, 1))
      expect(first?.mentions.map((mention) => mention.topic)).toEqual([
        'staff_service',
        'facilities_equipment',
      ])
      expect(first?.namesAPerson).toBe(true)
    })
  },
)
