import { describe, expect, it } from 'vitest'
import { buildGuestVoiceDetail, withDetailLiveEvidence } from './guest-voice-v2-details'
import {
  ISSUE,
  OTHER,
  group,
  input,
  mention,
  review,
} from './guest-voice-v2.test-fixtures'
import type { GuestVoiceBuildInput } from './guest-voice-v2-build'
import type { GuestVoiceMention, GuestVoiceReview } from './guest-voice-v2-facts'

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
    expect(drawer.dislikedCauses[0]?.title).toContain(
      'Room — musty smell (Cleanliness) · ',
    )
    expect(drawer.dislikedCauses[0]?.cause).toBe('musty smell')
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

const causeMention = (cause: string): GuestVoiceMention => ({
  mentionOrdinal: 0,
  topic: 'cleanliness',
  polarity: 'negative',
  strength: 'clear',
  thing: 'room',
  cause,
  issueGroupId: 'room',
  namesPerson: null,
})
const causeReview: GuestVoiceReview = {
  reviewId: 'review',
  sourceEpoch: 1,
  sourceRevision: 1,
  analysisSequence: 1,
  localDate: '2026-10-01',
  rating: 2,
  urgentReason: null,
  namesAPerson: false,
  mentions: [
    causeMention('musty smell'),
    causeMention('worn linen'),
    causeMention('musty smell'),
  ],
}
it('keeps the manager issue title on each row while preserving distinct, unique-per-review causes', () => {
  const build: GuestVoiceBuildInput = {
    propertyId: 'property',
    window: '30d',
    startLocalDate: '2026-09-02',
    endLocalDate: '2026-10-01',
    provisional: false,
    groups: new Map([
      [
        'room',
        {
          id: 'room',
          topic: 'cleanliness',
          canonicalThing: 'room',
          displayName: 'Our ROOM',
          hidden: false,
        },
      ],
    ]),
    current: [causeReview],
    baseline: [],
    currentPopulation: [],
    population: { textReviews: 1, stars: [0, 1, 0, 0, 0] },
  }
  const draft = buildGuestVoiceDetail({
    build,
    history: [causeReview],
    historyStartLocalDate: build.startLocalDate,
    target: { kind: 'topic', topic: 'cleanliness' },
  })
  if (draft?.read.drawer.kind !== 'topic') throw new Error('Expected a topic drawer')
  expect(draft.read.drawer.dislikedCauses).toEqual([
    { issueId: 'room', title: 'Our ROOM', cause: 'musty smell', reviewCount: 1 },
    { issueId: 'room', title: 'Our ROOM', cause: 'worn linen', reviewCount: 1 },
  ])
})
