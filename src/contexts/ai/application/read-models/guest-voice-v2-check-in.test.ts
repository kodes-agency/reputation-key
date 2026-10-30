import { describe, expect, it } from 'vitest'
import { reviewId } from '#/shared/domain/ids'
import { REVIEW_TOPICS_V3 } from '#/shared/review-topic-taxonomy'
import { addDays } from '../local-date'
import { ratingCountsOf } from '../aspect-review-evidence'
import { assembleGuestVoiceV2, type GuestVoiceBuildInput } from './guest-voice-v2-build'
import { groupSeriousConcerns, seriousConcerns } from './guest-voice-v2-concerns'
import { buildGuestVoiceDetail, withDetailLiveEvidence } from './guest-voice-v2-details'
import type {
  GuestVoiceIssueGroup,
  GuestVoiceMention,
  GuestVoiceReview,
} from './guest-voice-v2-facts'
import {
  ratingComparisonPeriods,
  ratingMonthSeries,
  buildRatingTrend,
} from './guest-voice-v2-rating-trend'
import { lastMentionedLocalDate } from './guest-voice-v2-recency'
import { tallyIssues, tallyTopics } from './guest-voice-v2-tally'
import { issueAnswerName, issueDisplayTitle, issueTitles } from './guest-voice-v2-titles'

const ISSUE = 'a0000000-0000-4000-8000-000000000001'
const OTHER = 'a0000000-0000-4000-8000-000000000002'
const group: GuestVoiceIssueGroup = {
  id: ISSUE,
  topic: 'cleanliness',
  canonicalThing: 'room',
  displayName: null,
  hidden: false,
}
const groups = new Map([
  [ISSUE, group],
  [OTHER, { ...group, id: OTHER }],
])
const mention = (over: Partial<GuestVoiceMention> = {}): GuestVoiceMention => ({
  mentionOrdinal: 0,
  topic: 'cleanliness',
  polarity: 'negative',
  strength: 'clear',
  thing: 'room',
  cause: 'musty smell',
  issueGroupId: ISSUE,
  namesPerson: null,
  ...over,
})
const review = (n: number, over: Partial<GuestVoiceReview> = {}): GuestVoiceReview => ({
  reviewId: `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  sourceEpoch: 1,
  sourceRevision: 1,
  analysisSequence: n,
  localDate: '2026-10-15',
  rating: 2,
  urgentReason: null,
  namesAPerson: false,
  mentions: [mention()],
  ...over,
})
function population(reviews: readonly GuestVoiceReview[]) {
  return reviews.map((r) => ({
    reviewId: reviewId(r.reviewId),
    sourceRevision: r.sourceRevision,
    analysisSequence: r.analysisSequence,
    localDate: r.localDate,
    rating: r.rating,
    hasText: true,
  }))
}
function input(
  current: readonly GuestVoiceReview[],
  over: Partial<GuestVoiceBuildInput> = {},
): GuestVoiceBuildInput {
  return {
    propertyId: 'property',
    window: '90d',
    startLocalDate: '2026-08-02',
    endLocalDate: '2026-10-30',
    provisional: false,
    current,
    baseline: [],
    currentPopulation: population(current),
    population: { textReviews: current.length, stars: ratingCountsOf(current) },
    groups,
    ...over,
  }
}

describe('fixed rating periods and calendar series', () => {
  it.each([
    [30, 7],
    [90, 22],
    [180, 45],
    [365, 90],
  ])('splits %i inclusive days into a fixed recent %i', (days, recentDays) => {
    const endLocalDate = '2026-10-30'
    const split = ratingComparisonPeriods({
      startLocalDate: addDays(endLocalDate, -(days - 1)),
      endLocalDate,
    })
    expect(split.recent.startLocalDate).toBe(addDays(endLocalDate, -(recentDays - 1)))
    expect(split.before.endLocalDate).toBe(addDays(split.recent.startLocalDate, -1))
  })
  it('includes 13 overlapping months, leap February, gaps and exact edge bounds', () => {
    const months = ratingMonthSeries([], {
      startLocalDate: '2023-10-31',
      endLocalDate: '2024-10-29',
    })
    expect(months).toHaveLength(13)
    expect(months[0]).toMatchObject({
      month: '2023-10',
      partialStart: true,
      partialEnd: false,
      startLocalDate: '2023-10-31',
    })
    expect(months.find((m) => m.month === '2024-02')).toMatchObject({
      endLocalDate: '2024-02-29',
      partialStart: false,
      partialEnd: false,
      averageStars: null,
      reviewCount: 0,
    })
    expect(months.at(-1)).toMatchObject({ partialEnd: true, endLocalDate: '2024-10-29' })
  })
  it('uses raw comment ratings including unanalysed comments, excluding star-only and outside days', () => {
    const raw = population([
      review(1, { rating: 1 }),
      review(2, { rating: 5 }),
      review(3, { rating: 5 }),
    ])
    const trend = buildRatingTrend(
      [
        ...raw,
        { ...raw[0]!, hasText: false },
        ...population([review(4, { localDate: '2026-07-31' })]),
      ],
      { startLocalDate: '2026-10-01', endLocalDate: '2026-10-31' },
      false,
    )
    expect(trend.months[0]).toMatchObject({
      reviewCount: 3,
      averageStars: 11 / 3,
      happyReviewCount: 2,
      partialEnd: false,
    })
    expect(trend.recent.reviewCount + trend.before.reviewCount).toBe(3)
    expect(trend.population).toBe('current_reviews_with_text')
  })
})

describe('topic tally, titles and recency', () => {
  it('partitions unique mentioning reviews into four disjoint categories and emits all twelve topics', () => {
    const current = [
      review(1, {
        mentions: [mention({ polarity: 'positive' }), mention({ polarity: 'positive' })],
      }),
      review(2),
      review(3, { mentions: [mention(), mention({ polarity: 'positive' })] }),
      review(4, { mentions: [mention({ polarity: 'neutral' })] }),
      review(5),
      review(6),
    ]
    expect(tallyTopics(current).get('cleanliness')?.assessment).toEqual({
      status: 'needs_attention',
      mentionedReviewCount: 6,
      happyReviewCount: 1,
      mixedReviewCount: 1,
      unhappyReviewCount: 3,
      neutralOnlyReviewCount: 1,
      happyShare: 1 / 6,
    })
    const read = assembleGuestVoiceV2(input(current)).read
    expect(read.everyTopic.map((t) => t.topic).sort()).toEqual(
      [...REVIEW_TOPICS_V3].sort(),
    )
    expect(read.everyTopic[0]?.topic).toBe('cleanliness')
  })
  it('counts causes once per review, respects manager names, keeps polarity titles separate', () => {
    const tallies = tallyIssues([
      review(1, {
        mentions: [
          mention(),
          mention(),
          mention({ polarity: 'positive', cause: 'comfortable' }),
        ],
      }),
      review(2, { mentions: [mention({ cause: 'worn furniture' })] }),
    ])
    const complaint = tallies.get(`${ISSUE}:complaint`)!
    expect(issueDisplayTitle(group, complaint)).toBe('Room — musty smell')
    expect(issueDisplayTitle({ ...group, displayName: 'Our ROOM' }, complaint)).toBe(
      'Our ROOM',
    )
    expect(issueDisplayTitle({ ...group, displayName: ' ' }, complaint)).toBe(
      'Room — musty smell',
    )
    expect(issueAnswerName(group, complaint)).toBe('Cleanliness')
    expect(issueDisplayTitle(group, tallies.get(`${ISSUE}:praise`)!)).toBe(
      'Room — comfortable',
    )
  })
  it('disambiguates automatic titles and never alters duplicate manager renames', () => {
    const tallies = [
      ...tallyIssues([
        review(1),
        review(2, { mentions: [mention({ issueGroupId: OTHER })] }),
      ]).values(),
    ]
    const titles = issueTitles(tallies, groups)
    expect(new Set(titles.values()).size).toBe(2)
    expect([
      ...issueTitles(
        tallies,
        new Map([...groups].map(([id, g]) => [id, { ...g, displayName: 'Same' }])),
      ).values(),
    ]).toEqual(['Same', 'Same'])
  })
  it('takes the latest member date and null only for no members', () => {
    expect(lastMentionedLocalDate([])).toBeNull()
    expect(
      lastMentionedLocalDate([
        review(1),
        review(1, { localDate: '2026-10-29' }),
        review(2, { localDate: '2026-01-01' }),
      ]),
    ).toBe('2026-10-29')
  })
})

describe('serious concern membership', () => {
  it('uses urgent members only, splits reasons, retains hidden issues and reason-only reports', () => {
    const current = [
      review(1, { urgentReason: 'health' }),
      review(2, { urgentReason: 'health', localDate: '2026-10-20' }),
      review(3, { urgentReason: 'safety' }),
      review(4, { urgentReason: 'health', mentions: [] }),
      review(5, { localDate: '2026-10-30' }),
    ]
    const concerns = seriousConcerns(
      groupSeriousConcerns(current, new Map([[ISSUE, { ...group, hidden: true }]])),
      false,
    )
    expect(concerns).toMatchObject({
      groupCount: 3,
      reviewCount: 4,
      remainingGroupCount: 0,
      coverage: 'complete',
    })
    expect(concerns.items[0]).toMatchObject({
      key: `issue:${ISSUE}:health`,
      reviewCount: 2,
      lastReportedLocalDate: '2026-10-20',
    })
    expect(concerns.items.find((c) => c.issueId === null)?.title).toBe(
      'Reported health concerns',
    )
  })
  it('chooses safety then strength then ordinal, ignores removed/non-surviving issues and keeps urgent flags', () => {
    const current = [
      review(1, {
        urgentReason: 'safety',
        mentions: [
          mention({ strength: 'strong' }),
          mention({
            topic: 'safety',
            issueGroupId: OTHER,
            strength: 'mild',
            mentionOrdinal: 1,
          }),
        ],
      }),
    ]
    expect(groupSeriousConcerns(current, groups)[0]?.item.issueId).toBe(OTHER)
    expect(groupSeriousConcerns(current, new Map())[0]?.item.key).toBe('other:safety')
    expect(
      groupSeriousConcerns(
        [
          review(2, {
            urgentReason: 'safety',
            mentions: [mention({ polarity: 'neutral' })],
          }),
        ],
        groups,
      )[0]?.item.issueId,
    ).toBeNull()
  })
  it('reports exact group/report overflow and provisional empty coverage', () => {
    const manyGroups = new Map(
      Array.from({ length: 12 }, (_, n) => [String(n), { ...group, id: String(n) }]),
    )
    const reviews = [...manyGroups.keys()].flatMap((id, n) => [
      review(n, { urgentReason: 'health', mentions: [mention({ issueGroupId: id })] }),
      review(100 + n, {
        urgentReason: 'health',
        mentions: [mention({ issueGroupId: id })],
      }),
    ])
    expect(
      seriousConcerns(groupSeriousConcerns(reviews, manyGroups), false),
    ).toMatchObject({
      groupCount: 12,
      reviewCount: 24,
      remainingGroupCount: 2,
      remainingReviewCount: 4,
    })
    expect(seriousConcerns([], true).coverage).toBe('provisional')
  })
})

describe('detail builders', () => {
  it('uses the analysed-comment set difference, same-sense recency, hidden evidence and overlapping concerns', () => {
    const current = [
      review(1, { urgentReason: 'health' }),
      review(2, {
        rating: 5,
        localDate: '2026-10-29',
        mentions: [mention({ polarity: 'positive' })],
      }),
      review(3, { rating: 4, mentions: [] }),
    ]
    const build = input(current, {
      groups: new Map([[ISSUE, { ...group, hidden: true }]]),
    })
    const draft = buildGuestVoiceDetail({
      build,
      history: current,
      historyStartLocalDate: build.startLocalDate,
      target: { kind: 'issue', issueId: ISSUE, sense: 'complaint' },
    })
    const drawer = draft?.read.drawer
    expect(drawer?.kind).toBe('issue')
    if (drawer?.kind !== 'issue') throw new Error('expected issue')
    expect(drawer.commentComparison).toEqual({
      population: 'current_analysed_comments',
      mentionedCount: 1,
      otherCount: 2,
      mentionedAverage: 2,
      othersAverage: 4.5,
    })
    expect(drawer.lastMentionedLocalDate).toBe('2026-10-15')
    expect(drawer.linkedConcerns).toHaveLength(1)
    expect(drawer.historyCoverage).toBe('window_only')
    expect(drawer.twelveMonthSeries).toHaveLength(3)
    expect(drawer.hidden).toBe(true)
    expect(drawer.liveEvidence).toEqual([])
  })
  it('returns twelve calendar months only when history covers them and counts praise in praise history', () => {
    const current = [review(1, { mentions: [mention({ polarity: 'positive' })] })]
    const history = [
      ...current,
      review(2, {
        localDate: '2025-11-02',
        mentions: [mention({ polarity: 'positive' })],
      }),
    ]
    const draft = buildGuestVoiceDetail({
      build: input(current),
      history,
      historyStartLocalDate: '2025-08-01',
      target: { kind: 'issue', issueId: ISSUE, sense: 'praise' },
    })
    const drawer = draft?.read.drawer
    if (drawer?.kind !== 'issue') throw new Error('expected issue')
    expect(drawer.historyCoverage).toBe('twelve_months')
    expect(drawer.twelveMonthSeries).toHaveLength(12)
    expect(drawer.twelveMonthSeries[0]).toMatchObject({
      month: '2025-11',
      reviewCount: 1,
    })
    expect(drawer.twelveMonthSeries.at(-1)).toMatchObject({
      partialEnd: true,
      endLocalDate: '2026-10-30',
    })
  })
  it('builds neutral-only and empty topic sheets; causes deduplicate per issue/cause/sense', () => {
    const current = [
      review(1, {
        mentions: [
          mention(),
          mention(),
          mention({ issueGroupId: OTHER }),
          mention({ polarity: 'positive' }),
        ],
        urgentReason: 'health',
      }),
    ]
    const draft = buildGuestVoiceDetail({
      build: input(current),
      history: current,
      historyStartLocalDate: '2026-08-02',
      target: { kind: 'topic', topic: 'cleanliness' },
    })
    const drawer = draft?.read.drawer
    if (drawer?.kind !== 'topic') throw new Error('expected topic')
    expect(drawer.dislikedCauses).toHaveLength(2)
    expect(drawer.dislikedCauses[0]?.title).toBe('Room — musty smell')
    expect(drawer.dislikedCauses.map((c) => c.reviewCount)).toEqual([1, 1])
    expect(drawer.likedCauses).toHaveLength(1)
    expect(drawer.assessment.mentionedReviewCount).toBe(1)
    expect(drawer.linkedConcerns).toHaveLength(1)
  })
  it('does not fabricate an issue/concern target and does not quote named sources', () => {
    const current = [review(1, { namesAPerson: true })]
    const args = {
      build: input(current),
      history: current,
      historyStartLocalDate: '2026-08-02',
    }
    expect(
      buildGuestVoiceDetail({
        ...args,
        target: { kind: 'issue', issueId: OTHER, sense: 'complaint' },
      }),
    ).toBeNull()
    expect(
      buildGuestVoiceDetail({
        ...args,
        target: { kind: 'concern', issueId: ISSUE, reason: 'health' },
      }),
    ).toBeNull()
    const draft = buildGuestVoiceDetail({
      ...args,
      target: { kind: 'issue', issueId: ISSUE, sense: 'complaint' },
    })!
    expect(draft.evidence[0]?.candidates).toEqual([])
    expect(withDetailLiveEvidence(draft, new Map())).toEqual(draft.read)
  })
})

describe('section totals and summary populations', () => {
  it('preserves list caps and exposes exact eligible totals while topics deduplicate overlapping issues', () => {
    const groups = new Map(
      Array.from({ length: 30 }, (_, n) => [String(n), { ...group, id: String(n) }]),
    )
    const complaints = Array.from({ length: 9 }, (_, n) =>
      [0, 1, 2].map((k) =>
        review(n * 3 + k, { mentions: [mention({ issueGroupId: String(n) })] }),
      ),
    ).flat()
    const praise = Array.from({ length: 7 }, (_, n) =>
      [0, 1, 2].map((k) =>
        review(100 + n * 3 + k, {
          mentions: [mention({ issueGroupId: String(n + 9), polarity: 'positive' })],
        }),
      ),
    ).flat()
    const watch = Array.from({ length: 14 }, (_, n) =>
      review(200 + n, { mentions: [mention({ issueGroupId: String(n + 16) })] }),
    )
    const read = assembleGuestVoiceV2(
      input([...complaints, ...praise, ...watch], { groups }),
    ).read
    expect(read.sectionTotals).toEqual({ fixFirst: 9, guestsLove: 7, watch: 14 })
    expect(read.remainingCounts).toEqual({ fixFirst: 1, guestsLove: 2, watch: 2 })
    expect([read.fixFirst.length, read.guestsLove.length, read.watch.length]).toEqual([
      8, 5, 12,
    ])
    const overlap = review(300, {
      mentions: [
        mention(),
        mention({ issueGroupId: OTHER }),
        mention({ polarity: 'positive' }),
      ],
    })
    const topic = assembleGuestVoiceV2(input([overlap])).read.everyTopic.find(
      (t) => t.topic === 'cleanliness',
    )
    expect(topic).toMatchObject({
      complaintReviews: 1,
      praiseReviews: 1,
      assessment: { mentionedReviewCount: 1, mixedReviewCount: 1 },
    })
  })
  it('keeps happy-share ordering ahead of unjudged topics with taxonomy order breaking ties', () => {
    const current = Array.from({ length: 6 }, (_, n) =>
      review(n, {
        mentions: [
          mention({ topic: 'staff_service', polarity: 'positive' }),
          mention({ topic: 'price_billing', polarity: n < 3 ? 'positive' : 'negative' }),
          mention({ topic: 'food_drink', polarity: n < 4 ? 'positive' : 'negative' }),
          mention({ topic: 'cleanliness', polarity: 'negative' }),
        ],
      }),
    )
    expect(
      assembleGuestVoiceV2(input(current))
        .read.everyTopic.slice(0, 4)
        .map((t) => [t.topic, t.assessment.status]),
    ).toEqual([
      ['cleanliness', 'needs_attention'],
      ['price_billing', 'mixed'],
      ['food_drink', 'doing_well'],
      ['staff_service', 'great'],
    ])
  })
})
