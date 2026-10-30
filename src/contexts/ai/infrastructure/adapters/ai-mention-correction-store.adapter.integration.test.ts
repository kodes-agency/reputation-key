// A manager's corrections to a v3 analysis through the real stores (PostgreSQL): written
// beside the kept answer, laid over it by the Guest voice read and the Inbox's current
// analysis read, undone, and left behind by a newer analysis. Every row is invented:
// ids, stars, topics and the numbers of sentences.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { getDb, type Database } from '#/shared/db'
import {
  aiReviewAnalysisMentionCorrections,
  aiReviewAnalysisMentions,
} from '#/shared/db/schema'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import type { MentionCorrectionAnalysisKey } from '../../application/ports/ai-mention-correction-store.port'
import { createAiGuestVoiceFactsAdapter } from './ai-guest-voice-facts.adapter'
import { createAiIssueGroupStoreAdapter } from './ai-issue-group-store.adapter'
import { createAiMentionCorrectionStoreAdapter } from './ai-mention-correction-store.adapter'
import { findCurrentReviewIdsByIssue } from './ai-current-issue-review-ids'
import {
  createV3Seed,
  mentionOf,
  seededReviewId,
  type SeededReview,
} from '../testing/ai-v3-seed'

const IDS = {
  organizationId: 'ai-corrections-test-org',
  propertyId: '78000000-0000-4000-8000-000000000001',
  idPrefix: '78000000',
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
const SHOWER = mentionOf({
  topic: 'facilities_equipment',
  polarity: 'negative',
  thing: 'shower',
  issue: 'cold',
  sentences: [3],
})
const STAFF_PRAISE = mentionOf({
  topic: 'staff_service',
  polarity: 'positive',
  sentences: [1],
})

/** Review 1 has four mentions; review 2 names the air conditioning too. */
const REVIEWS: readonly SeededReview[] = [
  {
    index: 1,
    rating: 2,
    reviewedAt: REVIEWED_AT,
    sentiment: 'mixed',
    attention: 'high',
    mentions: [AIR_CONDITIONING, SHOWER, STAFF_PRAISE],
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

function keyOf(index: number, analysisSequence = index): MentionCorrectionAnalysisKey {
  return {
    organizationId: organizationId(IDS.organizationId),
    propertyId: propertyId(IDS.propertyId),
    reviewId: reviewId(seededReviewId(IDS, index)),
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence,
  }
}

describe.sequential('manager corrections through the real stores (PostgreSQL)', () => {
  const db: Database = getDb()
  const seed = createV3Seed(db, IDS)
  const corrections = createAiMentionCorrectionStoreAdapter(db)
  const facts = createAiGuestVoiceFactsAdapter(db)
  const issues = createAiIssueGroupStoreAdapter(db)

  const apply = (
    index: number,
    mentionOrdinal: number,
    command: Parameters<typeof corrections.apply>[0]['command'],
    over: Partial<Parameters<typeof corrections.apply>[0]> = {},
  ) =>
    corrections.apply({
      key: keyOf(index),
      fences: FENCES,
      mentionOrdinal,
      command,
      correctedBy: 'a-manager',
      correctedAt: new Date('2026-10-30T12:00:00.000Z'),
      ...over,
    })

  async function reviewFacts(index: number) {
    const read = await facts.readFacts(seed.scope, PERIOD)
    return read?.reviews.find((review) => review.reviewId === seededReviewId(IDS, index))
  }

  async function currentAnalysis(index: number, analysisSequence = index) {
    return seed.outputs.readAnalysisForDelivery(
      {
        organizationId: organizationId(IDS.organizationId),
        actorUserId: userId('78000000-0000-4000-8000-0000000000aa'),
        propertyId: propertyId(IDS.propertyId),
        reviewId: reviewId(seededReviewId(IDS, index)),
        authorizationLineageId: '78000000-0002-4000-8000-000000000001',
        reviewAnalysisEpoch: 1,
        sourceEpoch: 0,
        sourceRevision: 1,
        analysisSequence,
        propertyProfileVersion: 1,
        analysisProfileVersion: 'review-analysis-v3',
        nowEpochMillis: new Date('2026-10-30T12:00:00.000Z').getTime(),
      },
      async (result) => result,
    )
  }

  async function clearCorrections() {
    await db
      .delete(aiReviewAnalysisMentionCorrections)
      .where(eq(aiReviewAnalysisMentionCorrections.organizationId, IDS.organizationId))
  }

  beforeAll(async () => {
    await seed.setUp()
    for (const review of REVIEWS) await seed.addReview(review)
    await seed.seal()
  })

  afterAll(async () => {
    await seed.tearDown()
  })

  it('sets a complaint aside as neutral when a manager says it is no problem', async () => {
    await clearCorrections()

    await expect(apply(1, 0, { kind: 'not_a_problem' })).resolves.toEqual({
      status: 'applied',
      mentionOrdinals: [0],
    })

    const review = await reviewFacts(1)
    expect(
      review?.mentions.map((mention) => [mention.mentionOrdinal, mention.polarity]),
    ).toEqual([
      [0, 'neutral'],
      [1, 'negative'],
      [2, 'positive'],
    ])
    // The answer is as the provider gave it.
    const [stored] = await db
      .select({ polarity: aiReviewAnalysisMentions.polarity })
      .from(aiReviewAnalysisMentions)
      .where(
        and(
          eq(aiReviewAnalysisMentions.organizationId, IDS.organizationId),
          eq(aiReviewAnalysisMentions.reviewId, seededReviewId(IDS, 1)),
          eq(aiReviewAnalysisMentions.mentionOrdinal, 0),
        ),
      )
    expect(stored?.polarity).toBe('negative')
  })

  it('shows the correction beside the kept answer in the Inbox’s current analysis', async () => {
    await clearCorrections()
    await apply(1, 0, { kind: 'not_a_problem' })

    const read = await currentAnalysis(1)

    if (read.status !== 'ready_v3')
      throw new Error(`expected a v3 analysis: ${read.status}`)
    expect(
      read.mentions.map((mention) => [
        mention.mentionOrdinal,
        mention.polarity,
        mention.correction?.kind ?? null,
      ]),
    ).toEqual([
      [0, 'negative', 'not_a_problem'],
      [1, 'negative', null],
      [2, 'positive', null],
    ])
    expect(read.mentions[0]?.issueGroupId).toEqual(expect.any(String))
    expect(read.mentions[0]?.correction).toMatchObject({
      kind: 'not_a_problem',
      correctedAtEpochMillis: new Date('2026-10-30T12:00:00.000Z').getTime(),
    })
  })

  it('refuses “not a problem” for something that is not a complaint', async () => {
    await clearCorrections()

    await expect(apply(1, 2, { kind: 'not_a_problem' })).resolves.toEqual({
      status: 'not_applicable',
    })
    await expect(
      db
        .select()
        .from(aiReviewAnalysisMentionCorrections)
        .where(eq(aiReviewAnalysisMentionCorrections.organizationId, IDS.organizationId)),
    ).resolves.toEqual([])
  })

  it('removes every mention of a topic together, and gives them back together', async () => {
    await clearCorrections()

    await expect(apply(1, 1, { kind: 'remove_topic' })).resolves.toEqual({
      status: 'applied',
      mentionOrdinals: [0, 1],
    })
    expect(
      (await reviewFacts(1))?.mentions.map((mention) => mention.mentionOrdinal),
    ).toEqual([2])
    const read = await currentAnalysis(1)
    if (read.status !== 'ready_v3') throw new Error('expected a v3 analysis')
    expect(read.mentions.map((mention) => mention.correction?.kind ?? null)).toEqual([
      'remove_topic',
      'remove_topic',
      null,
    ])

    await expect(
      corrections.clear({ key: keyOf(1), fences: FENCES, mentionOrdinal: 0 }),
    ).resolves.toEqual({ status: 'cleared', mentionOrdinals: [0, 1] })
    expect(
      (await reviewFacts(1))?.mentions.map((mention) => mention.mentionOrdinal),
    ).toEqual([0, 1, 2])
  })

  it('moves a changed cause to the issue of the new thing, creating it when there is none', async () => {
    await clearCorrections()
    const before = await reviewFacts(1)
    const airConditioningGroup = before?.mentions[0]?.issueGroupId

    await expect(
      apply(1, 0, { kind: 'change_cause', thing: 'heating', issue: 'too hot' }),
    ).resolves.toEqual({ status: 'applied', mentionOrdinals: [0] })

    const after = await reviewFacts(1)
    const moved = after?.mentions[0]
    expect(moved).toMatchObject({
      cause: 'too hot',
      polarity: 'negative',
      topic: 'facilities_equipment',
    })
    expect(moved?.issueGroupId).toEqual(expect.any(String))
    expect(moved?.issueGroupId).not.toBe(airConditioningGroup)
    const read = await facts.readFacts(seed.scope, PERIOD)
    expect(read?.groups.find((group) => group.id === moved?.issueGroupId)).toMatchObject({
      topic: 'facilities_equipment',
      canonicalThing: 'heating',
    })
    // Review 2 still names the air conditioning, as it was.
    const second = await reviewFacts(2)
    expect(second?.mentions[0]?.issueGroupId).toBe(airConditioningGroup)
  })

  it('moves a changed cause to an issue that already exists rather than making a second', async () => {
    await clearCorrections()
    const before = await reviewFacts(1)
    const showerGroup = before?.mentions[1]?.issueGroupId

    await apply(1, 0, { kind: 'change_cause', thing: 'shower', issue: 'no pressure' })

    const after = await reviewFacts(1)
    expect(after?.mentions[0]?.issueGroupId).toBe(showerGroup)
  })

  it('lets a topic-level cause name no thing', async () => {
    await clearCorrections()

    await expect(
      apply(1, 0, { kind: 'change_cause', thing: null, issue: 'unreliable' }),
    ).resolves.toMatchObject({ status: 'applied' })

    const read = await facts.readFacts(seed.scope, PERIOD)
    const group = read?.groups.find(
      (candidate) => candidate.id === read.reviews[0]?.mentions[0]?.issueGroupId,
    )
    expect(group).toMatchObject({ topic: 'facilities_equipment', canonicalThing: null })
  })

  it('replaces an earlier correction of the same mention with the later', async () => {
    await clearCorrections()
    await apply(1, 0, { kind: 'not_a_problem' })

    await apply(1, 0, { kind: 'change_cause', thing: 'heating', issue: 'too hot' })

    const rows = await db
      .select({ kind: aiReviewAnalysisMentionCorrections.kind })
      .from(aiReviewAnalysisMentionCorrections)
      .where(
        and(
          eq(aiReviewAnalysisMentionCorrections.organizationId, IDS.organizationId),
          eq(aiReviewAnalysisMentionCorrections.mentionOrdinal, 0),
        ),
      )
    expect(rows).toEqual([{ kind: 'change_cause' }])
    expect((await reviewFacts(1))?.mentions[0]).toMatchObject({
      polarity: 'negative',
      cause: 'too hot',
    })
  })

  it('answers not found for an analysis that is not the review’s current one, or a mention it lacks', async () => {
    await clearCorrections()

    await expect(apply(1, 9, { kind: 'remove_topic' })).resolves.toEqual({
      status: 'not_found',
    })
    await expect(
      apply(1, 0, { kind: 'remove_topic' }, { key: keyOf(1, 77) }),
    ).resolves.toEqual({ status: 'not_found' })
    await expect(
      apply(
        1,
        0,
        { kind: 'remove_topic' },
        { fences: { ...FENCES, reviewAnalysisEpoch: 2 } },
      ),
    ).resolves.toEqual({ status: 'not_found' })
    await expect(
      apply(
        1,
        0,
        { kind: 'remove_topic' },
        { fences: { ...FENCES, propertyProfileVersion: 2 } },
      ),
    ).resolves.toEqual({ status: 'not_found' })
    await expect(
      apply(
        1,
        0,
        { kind: 'remove_topic' },
        {
          key: { ...keyOf(1), organizationId: organizationId('another-organization') },
        },
      ),
    ).resolves.toEqual({ status: 'not_found' })
    await expect(
      corrections.clear({ key: keyOf(1), fences: FENCES, mentionOrdinal: 0 }),
    ).resolves.toEqual({ status: 'not_found' })
  })

  it('writes nothing for a changed cause that cannot be written, and leaves no issue behind', async () => {
    await clearCorrections()
    const groupsBefore = (await facts.readFacts(seed.scope, PERIOD))?.groups.length

    await expect(
      apply(1, 0, { kind: 'change_cause', thing: 'Not Lowercase!', issue: 'x' }),
    ).rejects.toMatchObject({
      // The use case folds a manager's words before they get here; the table's own check
      // is what refuses a phrase that was not, and the issue made on its way is rolled back.
      cause: {
        code: '23514',
        constraint: 'ai_review_analysis_mention_corrections_kind_valid',
      },
    })

    expect((await facts.readFacts(seed.scope, PERIOD))?.groups.length).toBe(groupsBefore)
    await expect(
      db
        .select()
        .from(aiReviewAnalysisMentionCorrections)
        .where(eq(aiReviewAnalysisMentionCorrections.organizationId, IDS.organizationId)),
    ).resolves.toEqual([])
  })

  it('leaves a correction behind with the old answer when a newer analysis replaces it', async () => {
    await clearCorrections()
    await apply(2, 0, { kind: 'remove_topic' })
    expect((await reviewFacts(2))?.mentions).toEqual([])

    await seed.reanalyze({
      index: 2,
      sequence: 3,
      rating: 2,
      reviewedAt: REVIEWED_AT,
      sentiment: 'negative',
      attention: 'high',
      mentions: [AIR_CONDITIONING],
    })

    // The new answer starts with no correction: the topic is back.
    expect((await reviewFacts(2))?.mentions.map((mention) => mention.topic)).toEqual([
      'facilities_equipment',
    ])
    // The old correction is still beside the old answer, but no longer effective.
    await expect(
      db
        .select({ sequence: aiReviewAnalysisMentionCorrections.analysisSequence })
        .from(aiReviewAnalysisMentionCorrections)
        .where(eq(aiReviewAnalysisMentionCorrections.organizationId, IDS.organizationId)),
    ).resolves.toEqual([{ sequence: 2 }])
    // And a correction cannot be written for the answer that was replaced.
    await expect(apply(2, 0, { kind: 'remove_topic' })).resolves.toEqual({
      status: 'not_found',
    })
    await expect(
      corrections.apply({
        key: keyOf(2, 3),
        fences: FENCES,
        mentionOrdinal: 0,
        command: { kind: 'remove_topic' },
        correctedBy: 'a-manager',
        correctedAt: new Date(),
      }),
    ).resolves.toMatchObject({ status: 'applied' })
  })

  describe('the Inbox’s filter by issue', () => {
    const find = (
      issueId: string,
      polarities?: readonly ('positive' | 'neutral' | 'negative')[],
    ) =>
      findCurrentReviewIdsByIssue(db, {
        organizationId: IDS.organizationId,
        issueId,
        ...(polarities === undefined ? {} : { polarities }),
        nowEpochMillis: new Date('2026-10-30T12:00:00.000Z').getTime(),
      })

    async function airConditioningIssue(): Promise<string> {
      const read = await facts.readFacts(seed.scope, PERIOD)
      const group = read?.groups.find(
        (candidate) => candidate.canonicalThing === 'air conditioning',
      )
      if (group === undefined) throw new Error('the seed has no such issue')
      return group.id
    }

    it('finds the reviews that name the issue, by the way they feel about it', async () => {
      await clearCorrections()
      const issueId = await airConditioningIssue()

      const all = await find(issueId)
      const complaints = await find(issueId, ['negative'])
      const praise = await find(issueId, ['positive'])

      expect([...all].sort()).toEqual(
        [seededReviewId(IDS, 1), seededReviewId(IDS, 2)].sort(),
      )
      expect([...complaints].sort()).toEqual([...all].sort())
      expect(praise).toEqual([])
    })

    it('lays a manager’s correction over the answer', async () => {
      await clearCorrections()
      const issueId = await airConditioningIssue()
      await apply(1, 0, { kind: 'not_a_problem' })

      expect(await find(issueId, ['negative'])).toEqual([seededReviewId(IDS, 2)])
      expect([...(await find(issueId, ['neutral']))]).toEqual([seededReviewId(IDS, 1)])

      await clearCorrections()
      await apply(2, 0, { kind: 'remove_topic' }, { key: keyOf(2, 3) })
      expect(await find(issueId)).toEqual([seededReviewId(IDS, 1)])
    })

    it('follows a changed cause to the issue it moved to', async () => {
      await clearCorrections()
      await apply(1, 0, { kind: 'change_cause', thing: 'shower', issue: 'cold' })
      const read = await facts.readFacts(seed.scope, PERIOD)
      const shower = read?.groups.find(
        (candidate) => candidate.canonicalThing === 'shower',
      )

      expect(await find(shower?.id ?? '')).toEqual([seededReviewId(IDS, 1)])
      expect(await find(await airConditioningIssue())).toEqual([seededReviewId(IDS, 2)])
    })

    it('follows a merge to the issue that survived, from either id', async () => {
      await clearCorrections()
      const read = await facts.readFacts(seed.scope, PERIOD)
      const shower = read?.groups.find(
        (candidate) => candidate.canonicalThing === 'shower',
      )
      const airConditioning = await airConditioningIssue()
      const scope = { organizationId: IDS.organizationId, propertyId: IDS.propertyId }
      await issues.merge(scope, shower?.id ?? '', airConditioning, new Date())

      const merged = await find(airConditioning)
      expect([...merged].sort()).toEqual(
        [seededReviewId(IDS, 1), seededReviewId(IDS, 2)].sort(),
      )
      expect([...(await find(shower?.id ?? ''))].sort()).toEqual([...merged].sort())
    })

    it('finds nothing for an issue that does not exist, or in another organization', async () => {
      await clearCorrections()

      expect(await find('78000000-0000-4000-8000-0000000000ff')).toEqual([])
      expect(
        await findCurrentReviewIdsByIssue(db, {
          organizationId: 'another-organization',
          issueId: await airConditioningIssue(),
          nowEpochMillis: Date.now(),
        }),
      ).toEqual([])
    })
  })
})
