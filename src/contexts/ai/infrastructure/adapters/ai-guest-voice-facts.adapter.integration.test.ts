// The Guest voice 2.0 read through the real stores (PostgreSQL): reviews that carry a v3
// analysis are written the way production writes them, then read back as the page's facts
// and, through the use case, as the page itself. Review's own count of the Property's
// reviews is the one thing stood in for. Every row is invented; no guest's words exist
// here, only ids, stars, topics and the numbers of sentences.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb, type Database } from '#/shared/db'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { mentionRefKey } from '../../application/ports/ai-guest-voice-facts.port'
import {
  createReadGuestVoiceV2,
  type GuestVoiceV2Response,
} from '../../application/use-cases/read-guest-voice-v2'
import { createReadGuestVoiceDetail } from '../../application/use-cases/read-guest-voice-detail'
import type { ReadGuestVoiceV2Dependencies } from '../../application/use-cases/read-guest-voice-v2'
import { createAiIssueGroupStoreAdapter } from './ai-issue-group-store.adapter'
import { createAiAuthorizationAdapter } from './ai-authorization.adapter'
import { createAiPropertyCalendarAdapter } from './ai-property-calendar.adapter'
import { createAiGuestVoiceFactsAdapter } from './ai-guest-voice-facts.adapter'
import { createPropertyProcessingProfileAdapter } from './property-processing-profile.adapter'
import {
  createV3Seed,
  mentionOf,
  seededReviewId,
  type SeededReview,
} from '../testing/ai-v3-seed'

const IDS = {
  organizationId: 'ai-gv2-facts-test-org',
  propertyId: '77000000-0000-4000-8000-000000000001',
  idPrefix: '77000000',
} as const

const NOON = (month: number, day: number, year = 2026) =>
  new Date(Date.UTC(year, month - 1, day, 16, 0, 0))

const AIR_CONDITIONING = {
  topic: 'facilities_equipment',
  polarity: 'negative',
  thing: 'air conditioning',
  issue: 'not working',
  sentences: [2],
} as const

/** Ten invented reviews: nine in October, and one from the November before. */
const REVIEWS: readonly SeededReview[] = [
  ...[1, 2, 3].map((index): SeededReview => ({
    index,
    rating: 2,
    reviewedAt: NOON(10, 8 + index),
    sentiment: 'negative',
    attention: 'high',
    mentions: [mentionOf(AIR_CONDITIONING)],
  })),
  {
    index: 4,
    rating: 5,
    reviewedAt: NOON(10, 12),
    sentiment: 'positive',
    mentions: [
      mentionOf({
        topic: 'staff_service',
        polarity: 'positive',
        strength: 'strong',
        sentences: [1],
        namesPerson: 'team_member',
      }),
    ],
  },
  {
    index: 5,
    rating: 1,
    reviewedAt: NOON(10, 14),
    sentiment: 'negative',
    attention: 'urgent',
    urgentReason: 'safety',
    mentions: [
      mentionOf({
        topic: 'safety',
        polarity: 'negative',
        strength: 'strong',
        thing: 'balcony railing',
        issue: 'loose',
        sentences: [1, 2],
      }),
    ],
  },
  {
    index: 6,
    rating: 3,
    reviewedAt: NOON(10, 15),
    sentiment: 'neutral',
    mentions: [mentionOf({ topic: 'location_access', polarity: 'neutral' })],
  },
  { index: 7, rating: 4, reviewedAt: NOON(10, 16), sentiment: 'neutral', mentions: [] },
  {
    index: 8,
    rating: 2,
    reviewedAt: NOON(10, 17),
    sentiment: 'negative',
    mentions: [mentionOf({ ...AIR_CONDITIONING, sentences: [1] })],
  },
  {
    index: 9,
    rating: 3,
    reviewedAt: NOON(10, 18),
    sentiment: 'mixed',
    mentions: [
      mentionOf({ topic: 'staff_service', polarity: 'positive' }),
      mentionOf({ topic: 'staff_service', polarity: 'negative', issue: 'slow' }),
    ],
  },
  {
    index: 10,
    rating: 4,
    reviewedAt: NOON(11, 3, 2025),
    sentiment: 'positive',
    mentions: [
      mentionOf({
        topic: 'food_drink',
        polarity: 'positive',
        thing: 'breakfast',
        issue: 'fresh',
      }),
    ],
  },
]

describe.sequential('Guest voice 2.0 read through the real stores (PostgreSQL)', () => {
  const db: Database = getDb()
  const seed = createV3Seed(db, IDS)
  const facts = createAiGuestVoiceFactsAdapter(db)
  const scope = seed.scope

  beforeAll(async () => {
    await seed.setUp()
    for (const review of REVIEWS) await seed.addReview(review)
    await seed.seal()
  })

  afterAll(async () => {
    await seed.tearDown()
  })

  it('knows a Property has v3 analyses, and one without does not', async () => {
    await expect(facts.hasV3Analyses(scope)).resolves.toBe(true)
    await expect(
      facts.hasV3Analyses({
        ...scope,
        propertyId: propertyId(IDS.propertyId.replace(/1$/, '2')),
      }),
    ).resolves.toBe(false)
    await expect(facts.hasV3Analyses({ ...scope, reviewAnalysisEpoch: 2 })).resolves.toBe(
      false,
    )
  })

  it('reads the reviews of a period with their mentions and the issues those belong to', async () => {
    const read = await facts.readFacts(scope, {
      startLocalDate: '2026-10-01',
      endLocalDate: '2026-10-31',
    })

    expect(read).not.toBeNull()
    if (read === null) return
    expect(read.coverage).toEqual({
      settledAnalysisCount: 10,
      expectedAnalysisCount: 10,
      awaitingAnalysisCount: 0,
    })
    expect(read.reviews.map((review) => review.reviewId)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => seededReviewId(IDS, index)),
    )
    // The stores write no v3 outcome for a review in a language the analysis cannot read.
    expect(read.unavailable).toEqual([])

    const first = read.reviews[0]
    expect(first).toMatchObject({
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 1,
      localDate: '2026-10-09',
      rating: 2,
      urgentReason: null,
    })
    expect(first?.mentions).toEqual([
      {
        mentionOrdinal: 0,
        topic: 'facilities_equipment',
        polarity: 'negative',
        strength: 'clear',
        thing: 'air conditioning',
        cause: 'not working',
        issueGroupId: expect.any(String),
        namesPerson: null,
      },
    ])
    // Three reviews name the same thing, so they name one issue.
    const groupOf = (index: number) =>
      read.reviews.find((review) => review.reviewId === seededReviewId(IDS, index))
        ?.mentions[0]?.issueGroupId
    expect(groupOf(2)).toBe(groupOf(1))
    expect(groupOf(8)).toBe(groupOf(1))
    expect(groupOf(5)).not.toBe(groupOf(1))

    const urgent = read.reviews.find((review) => review.urgentReason !== null)
    expect(urgent).toMatchObject({
      reviewId: seededReviewId(IDS, 5),
      urgentReason: 'safety',
    })
    const staff = read.reviews.find(
      (review) => review.reviewId === seededReviewId(IDS, 4),
    )
    expect(staff?.mentions[0]?.namesPerson).toBe('team_member')
    const empty = read.reviews.find(
      (review) => review.reviewId === seededReviewId(IDS, 7),
    )
    expect(empty?.mentions).toEqual([])

    expect(
      read.groups
        .map((group) => [
          group.topic,
          group.canonicalThing,
          group.displayName,
          group.hidden,
        ])
        .sort(),
    ).toEqual(
      [
        ['facilities_equipment', 'air conditioning', null, false],
        ['safety', 'balcony railing', null, false],
        ['staff_service', null, null, false],
        ['location_access', null, null, false],
        ['food_drink', 'breakfast', null, false],
      ].sort(),
    )
  })

  it('leaves out the reviews of other days, whole', async () => {
    const read = await facts.readFacts(scope, {
      startLocalDate: '2025-10-01',
      endLocalDate: '2025-12-31',
    })

    expect(read?.reviews.map((review) => review.reviewId)).toEqual([
      seededReviewId(IDS, 10),
    ])
    expect(read?.unavailable).toEqual([])
  })

  it('reads the sentences each mention cites, in order', async () => {
    const sentences = await facts.readMentionSentences(scope, [
      {
        reviewId: seededReviewId(IDS, 5),
        sourceRevision: 1,
        analysisSequence: 5,
        mentionOrdinal: 0,
      },
      {
        reviewId: seededReviewId(IDS, 1),
        sourceRevision: 1,
        analysisSequence: 1,
        mentionOrdinal: 0,
      },
      // A mention that does not exist cites nothing.
      {
        reviewId: seededReviewId(IDS, 1),
        sourceRevision: 1,
        analysisSequence: 1,
        mentionOrdinal: 7,
      },
    ])

    expect(Object.fromEntries(sentences)).toEqual({
      [mentionRefKey({ reviewId: seededReviewId(IDS, 5), mentionOrdinal: 0 })]: [1, 2],
      [mentionRefKey({ reviewId: seededReviewId(IDS, 1), mentionOrdinal: 0 })]: [2],
    })
    await expect(facts.readMentionSentences(scope, [])).resolves.toEqual(new Map())
  })

  it('reads nothing of a Property that is not the reader’s', async () => {
    const read = await facts.readFacts(
      { ...scope, organizationId: organizationId('another-organization') },
      { startLocalDate: '2026-10-01', endLocalDate: '2026-10-31' },
    )

    expect(read).toBeNull()
  })

  it('shows a manager’s hiding and renaming on the issue', async () => {
    const before = await facts.readFacts(scope, {
      startLocalDate: '2026-10-01',
      endLocalDate: '2026-10-31',
    })
    const airConditioning = before?.groups.find(
      (group) => group.canonicalThing === 'air conditioning',
    )
    if (airConditioning === undefined) throw new Error('the seed has no such issue')
    const issues = createAiIssueGroupStoreAdapter(db)
    const issueScope = { organizationId: IDS.organizationId, propertyId: IDS.propertyId }

    await issues.rename(issueScope, airConditioning.id, 'Room AC', new Date())
    await issues.setHidden(
      issueScope,
      airConditioning.id,
      { at: new Date(), by: 'a-manager' },
      new Date(),
    )
    const after = await facts.readFacts(scope, {
      startLocalDate: '2026-10-01',
      endLocalDate: '2026-10-31',
    })
    await issues.setHidden(issueScope, airConditioning.id, null, new Date())
    await issues.rename(issueScope, airConditioning.id, null, new Date())

    expect(after?.groups.find((group) => group.id === airConditioning.id)).toMatchObject({
      displayName: 'Room AC',
      hidden: true,
    })
  })

  describe('as the page', () => {
    function pageDependencies(): ReadGuestVoiceV2Dependencies {
      // Review's count of the Property's reviews: every seeded review, with text, on its day.
      const population = REVIEWS.map((review) => ({
        reviewId: reviewId(seededReviewId(IDS, review.index)),
        sourceRevision: 1,
        analysisSequence: review.index,
        localDate: review.reviewedAt.toISOString().slice(0, 10),
        hasText: true,
        rating: review.rating,
      })).sort((left, right) => left.localDate.localeCompare(right.localDate))
      return {
        propertyAccess: async () => [],
        authorization: createAiAuthorizationAdapter(db),
        processingProfiles: createPropertyProcessingProfileAdapter(db, () => new Date()),
        calendar: createAiPropertyCalendarAdapter(db),
        facts,
        reviewSources: {
          readTrendPopulation: async (request) => ({
            status: 'complete' as const,
            reviews: population.filter(
              (review) =>
                review.localDate >= request.startLocalDate &&
                review.localDate <= request.endLocalDate,
            ),
            hasEvidenceBeforeStart: false,
          }),
        },
        nowEpochMillis: () => Date.UTC(2026, 9, 25, 16, 0, 0),
      }
    }
    function pageInput(range: 'auto' | '30d' = 'auto') {
      return {
        organizationId: organizationId(IDS.organizationId),
        propertyId: propertyId(IDS.propertyId),
        actor: buildTestAuthContext({
          organizationId: organizationId(IDS.organizationId),
          userId: userId('77000000-0000-4000-8000-0000000000aa'),
          role: 'AccountAdmin',
        }),
        range,
      }
    }
    function readPage(range: 'auto' | '30d' = 'auto') {
      return createReadGuestVoiceV2(pageDependencies())(pageInput(range))
    }

    function draftOf(response: GuestVoiceV2Response) {
      if (response.status !== 'drafted')
        throw new Error(`expected a draft: ${response.status}`)
      return response.draft
    }

    it('draws what the analysis says of the Property’s reviews', async () => {
      const draft = draftOf(await readPage('30d'))
      const page = draft.read
      if (page.status !== 'ready') throw new Error('expected a ready page')

      expect(page).toMatchObject({
        window: '30d',
        startLocalDate: '2026-09-26',
        endLocalDate: '2026-10-25',
        // Review counted nine reviews in the window; the analysis has all of them.
        basis: { textReviewCount: 9, starOnlyCount: 0 },
        provisional: false,
      })
      // Four reviews with an analysis say air conditioning is not working: three at two
      // stars, and the fourth too, each counted once.
      expect(
        page.fixFirst.map((item) => [item.title, item.statistics.reviewCount]),
      ).toEqual([['Air conditioning — not working', 4]])
      expect(page.fixFirst[0]?.causes).toEqual(['Not working'])
      expect(page.urgent.map((item) => [item.title, item.urgentReason])).toEqual([
        ['Balcony railing — loose', 'safety'],
      ])
      expect(page.staffPraise?.reviewCount).toBe(1)
      // One review each, so by name.
      expect(page.watch.map((item) => item.title)).toEqual([
        'Balcony railing — loose',
        'Staff and service — slow',
      ])
    })

    it('reads issue, topic and concern details from the same live facts with dated counts', async () => {
      const page = draftOf(await readPage('30d')).read
      if (page.status !== 'ready') throw new Error('expected ready page')
      const readDetail = createReadGuestVoiceDetail(pageDependencies())
      const base = {
        ...pageInput('30d'),
        startLocalDate: page.startLocalDate,
        endLocalDate: page.endLocalDate,
      }
      const issueId = page.fixFirst[0]?.issueId
      if (!issueId) throw new Error('expected issue')
      const issue = await readDetail({
        ...base,
        target: { kind: 'issue', issueId, sense: 'complaint' },
      })
      if (issue.status !== 'drafted') throw new Error('expected detail')
      expect(issue.draft.read.drawer).toMatchObject({
        kind: 'issue',
        title: 'Air conditioning — not working',
        lastMentionedLocalDate: '2026-10-17',
        commentComparison: {
          population: 'current_analysed_comments',
          mentionedCount: 4,
          otherCount: 5,
        },
        historyCoverage: 'twelve_months',
        liveEvidence: [],
      })
      expect(
        issue.draft.evidence[0]?.candidates[0]?.sentenceNumbers.length,
      ).toBeGreaterThan(0)
      const topic = await readDetail({
        ...base,
        target: { kind: 'topic', topic: 'staff_service' },
      })
      if (topic.status !== 'drafted') throw new Error('expected topic')
      expect(topic.draft.read.drawer).toMatchObject({
        kind: 'topic',
        assessment: {
          mentionedReviewCount: 2,
          mixedReviewCount: 1,
          happyReviewCount: 1,
          status: 'unjudged',
        },
      })
      const concern = page.seriousConcerns.items[0]
      if (!concern) throw new Error('expected concern')
      const detail = await readDetail({
        ...base,
        target: {
          kind: 'concern',
          issueId: concern.issueId,
          reason: concern.urgentReason,
        },
      })
      if (detail.status !== 'drafted') throw new Error('expected concern detail')
      expect(detail.draft.read.drawer).toMatchObject({
        kind: 'concern',
        reviewCount: 1,
        lastReportedLocalDate: '2026-10-14',
      })
      expect(
        await readDetail({
          ...base,
          endLocalDate: '2026-10-24',
          target: { kind: 'topic', topic: 'safety' },
        }),
      ).toEqual({ status: 'refresh_required' })
      expect(
        await readDetail({
          ...base,
          target: {
            kind: 'issue',
            issueId: '77000000-0000-4000-8000-000000000099',
            sense: 'complaint',
          },
        }),
      ).toEqual({ status: 'not_found' })
    })

    it('offers as the quote for a card only reviews that name nobody, with the sentences they cite', async () => {
      const draft = draftOf(await readPage('30d'))

      const fixFirst = draft.evidence.find((slot) => slot.section === 'fixFirst')
      expect(fixFirst?.candidates.map((candidate) => candidate.sentenceNumbers)).toEqual(
        expect.arrayContaining([[2], [1]]),
      )
      const urgent = draft.evidence.find((slot) => slot.section === 'urgent')
      expect(urgent?.candidates.map((candidate) => candidate.reviewId)).toEqual([
        seededReviewId(IDS, 5),
      ])
      expect(urgent?.candidates[0]?.sentenceNumbers).toEqual([1, 2])
    })
  })
})
