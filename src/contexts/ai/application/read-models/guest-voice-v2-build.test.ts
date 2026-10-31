import { describe, expect, it } from 'vitest'
import type { ReviewPolarityV3, ReviewStrengthV3 } from '#/shared/review-analysis-v3'
import type { ReviewTopicV3 } from '#/shared/review-topic-taxonomy'
import { assembleGuestVoiceV2, type GuestVoiceBuildInput } from './guest-voice-v2-build'
import type {
  GuestVoiceIssueGroup,
  GuestVoiceMention,
  GuestVoiceReview,
  StarValue,
} from './guest-voice-v2-facts'

// Issues of an invented hotel. The ids are the shape of a real one and nothing else.
const AC = 'a0000000-0000-4000-8000-000000000001'
const SHOWER = 'a0000000-0000-4000-8000-000000000002'
const STAFF = 'a0000000-0000-4000-8000-000000000003'
const NOISE = 'a0000000-0000-4000-8000-000000000004'
const RAILING = 'a0000000-0000-4000-8000-000000000005'
const BREAKFAST = 'a0000000-0000-4000-8000-000000000006'

function group(
  id: string,
  topic: ReviewTopicV3,
  canonicalThing: string | null,
  over: Partial<GuestVoiceIssueGroup> = {},
): GuestVoiceIssueGroup {
  return { id, topic, canonicalThing, displayName: null, hidden: false, ...over }
}

const GROUPS: ReadonlyMap<string, GuestVoiceIssueGroup> = new Map(
  [
    group(AC, 'facilities_equipment', 'air conditioning'),
    group(SHOWER, 'facilities_equipment', 'shower'),
    group(STAFF, 'staff_service', null),
    group(NOISE, 'atmosphere_noise', 'street noise'),
    group(RAILING, 'safety', 'balcony railing'),
    group(BREAKFAST, 'food_drink', 'breakfast'),
  ].map((entry) => [entry.id, entry]),
)

type MentionSpec = Readonly<{
  group: string
  topic: ReviewTopicV3
  polarity: ReviewPolarityV3
  cause?: string | null
  strength?: ReviewStrengthV3
  namesPerson?: GuestVoiceMention['namesPerson']
}>

const complaint = (
  groupId: string,
  topic: ReviewTopicV3,
  cause: string | null = null,
  strength: ReviewStrengthV3 = 'clear',
): MentionSpec => ({ group: groupId, topic, polarity: 'negative', cause, strength })

const praise = (
  groupId: string,
  topic: ReviewTopicV3,
  cause: string | null = null,
  namesPerson: GuestVoiceMention['namesPerson'] = null,
): MentionSpec => ({ group: groupId, topic, polarity: 'positive', cause, namesPerson })

let counter = 0
function review(
  rating: StarValue,
  mentions: readonly MentionSpec[],
  over: Partial<GuestVoiceReview> = {},
): GuestVoiceReview {
  counter += 1
  return {
    reviewId: `b0000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: counter,
    localDate: '2026-10-10',
    rating,
    urgentReason: null,
    namesAPerson: mentions.some((spec) => (spec.namesPerson ?? null) !== null),
    mentions: mentions.map((spec, index) => ({
      mentionOrdinal: index,
      topic: spec.topic,
      polarity: spec.polarity,
      strength: spec.strength ?? 'clear',
      thing: null,
      cause: spec.cause ?? null,
      issueGroupId: spec.group,
      namesPerson: spec.namesPerson ?? null,
    })),
    ...over,
  }
}

/** n reviews of the same shape. */
function many(n: number, make: (index: number) => GuestVoiceReview) {
  return Array.from({ length: n }, (_, index) => make(index))
}

// 40 reviews with text and 20 with only stars in the window.
const STARS_OF_THE_WINDOW = [4, 6, 8, 18, 24] as const

function input(over: Partial<GuestVoiceBuildInput> = {}): GuestVoiceBuildInput {
  return {
    propertyId: '11111111-1111-4111-8111-111111111111',
    window: '90d',
    startLocalDate: '2026-08-02',
    endLocalDate: '2026-10-30',
    provisional: false,
    currentPopulation: [],
    population: { stars: STARS_OF_THE_WINDOW, textReviews: 40 },
    groups: GROUPS,
    current: [],
    baseline: [],
    ...over,
  }
}

describe('assembleGuestVoiceV2', () => {
  it('ranks a problem named in three reviews and keeps one or two on the watch list', () => {
    const { read } = assembleGuestVoiceV2(
      input({
        current: [
          ...many(3, () =>
            review(2, [complaint(AC, 'facilities_equipment', 'not working')]),
          ),
          ...many(2, () =>
            review(3, [complaint(SHOWER, 'facilities_equipment', 'cold')]),
          ),
          review(1, [complaint(NOISE, 'atmosphere_noise', 'loud')]),
        ],
      }),
    )

    expect(read.fixFirst.map((item) => item.title)).toEqual([
      'Air conditioning — not working',
    ])
    expect(read.fixFirst[0]).toMatchObject({
      issueId: AC,
      topic: 'facilities_equipment',
      causes: ['Not working'],
      urgentReason: null,
    })
    expect(read.watch).toMatchObject([
      {
        issueId: SHOWER,
        title: 'Shower — cold',
        topic: 'facilities_equipment',
        reviewCount: 2,
      },
      {
        issueId: NOISE,
        title: 'Street noise — loud',
        topic: 'atmosphere_noise',
        reviewCount: 1,
      },
    ])
  })

  it('ranks Fix first by the stars at stake, not by how often an issue is named', () => {
    // Shower: four reviews of 1 star. Air conditioning: five reviews of 4 stars, which cost little.
    const { read } = assembleGuestVoiceV2(
      input({
        current: [
          ...many(4, () => review(1, [complaint(SHOWER, 'facilities_equipment')])),
          ...many(5, () => review(4, [complaint(AC, 'facilities_equipment')])),
        ],
      }),
    )

    expect(read.fixFirst.map((item) => item.issueId)).toEqual([SHOWER, AC])
    expect(read.fixFirst[0]?.statistics.upTo).toBeGreaterThan(
      read.fixFirst[1]?.statistics.upTo ?? 0,
    )
  })

  it('counts a review that names an issue twice once', () => {
    const { read } = assembleGuestVoiceV2(
      input({
        current: many(3, () =>
          review(2, [
            complaint(AC, 'facilities_equipment', 'not working'),
            complaint(AC, 'facilities_equipment', 'noisy'),
          ]),
        ),
      }),
    )

    expect(read.fixFirst[0]?.statistics.reviewCount).toBe(3)
    expect(read.fixFirst[0]?.causes).toEqual(['Noisy', 'Not working'])
  })

  it('names an issue by what a manager called it, else the thing, else the topic', () => {
    const named = new Map(GROUPS)
    named.set(
      AC,
      group(AC, 'facilities_equipment', 'air conditioning', { displayName: 'Room AC' }),
    )
    const { read } = assembleGuestVoiceV2(
      input({
        groups: named,
        current: [
          ...many(3, () => review(2, [complaint(AC, 'facilities_equipment')])),
          ...many(3, () => review(2, [complaint(STAFF, 'staff_service')])),
        ],
      }),
    )

    expect(read.fixFirst.map((item) => item.title).sort()).toEqual([
      'Room AC',
      'Staff and service',
    ])
  })

  it('leaves a hidden issue out of every ranking but keeps it in the topic row', () => {
    const hiddenGroups = new Map(GROUPS)
    hiddenGroups.set(
      AC,
      group(AC, 'facilities_equipment', 'air conditioning', { hidden: true }),
    )
    const { read } = assembleGuestVoiceV2(
      input({
        groups: hiddenGroups,
        current: many(4, () => review(2, [complaint(AC, 'facilities_equipment')])),
      }),
    )

    expect(read.fixFirst).toEqual([])
    expect(read.watch).toMatchObject([])
    expect(
      read.everyTopic
        .filter((row) => row.statistics.reviewCount > 0)
        .map((row) => [row.topic, row.complaintReviews]),
    ).toEqual([['facilities_equipment', 4]])
  })

  it('lists praise from three reviews, most named first', () => {
    const { read } = assembleGuestVoiceV2(
      input({
        current: [
          ...many(5, () => review(5, [praise(STAFF, 'staff_service')])),
          ...many(3, () => review(5, [praise(BREAKFAST, 'food_drink', 'fresh')])),
          ...many(2, () => review(5, [praise(AC, 'facilities_equipment')])),
        ],
      }),
    )

    expect(read.guestsLove.map((item) => item.title)).toEqual([
      'Staff and service',
      'Breakfast — fresh',
    ])
    expect(read.guestsLove[0]?.statistics.shareText).toBe('5 of 10')
  })

  it('says how many reviews praise a team member by name, and nothing else about them', () => {
    const { read } = assembleGuestVoiceV2(
      input({
        current: [
          review(5, [praise(STAFF, 'staff_service', null, 'team_member')]),
          review(5, [praise(STAFF, 'staff_service', null, 'team_member')]),
          review(5, [praise(STAFF, 'staff_service', null, 'other')]),
          review(2, [
            { ...complaint(STAFF, 'staff_service'), namesPerson: 'team_member' },
          ]),
        ],
      }),
    )

    expect(read.staffPraise).toEqual({
      reviewCount: 2,
      inboxHref:
        '/inbox?propertyId=11111111-1111-4111-8111-111111111111&since=2026-08-02&until=2026-10-30',
    })
  })

  it('has no staff line when no review praises a team member by name', () => {
    const { read } = assembleGuestVoiceV2(
      input({ current: [review(5, [praise(STAFF, 'staff_service')])] }),
    )

    expect(read.staffPraise).toBeNull()
  })

  it('puts an Urgent review above everything, under the problem it reports, with its reason', () => {
    const urgent = review(
      1,
      [
        complaint(RAILING, 'safety', 'loose', 'strong'),
        complaint(AC, 'facilities_equipment', 'not working'),
      ],
      { urgentReason: 'safety' },
    )
    const { read } = assembleGuestVoiceV2(input({ current: [urgent] }))

    expect(read.urgent).toHaveLength(1)
    expect(read.urgent[0]).toMatchObject({
      issueId: RAILING,
      title: 'Balcony railing — loose',
      topic: 'safety',
      urgentReason: 'safety',
      causes: ['Loose'],
    })
    expect(read.urgentOtherCount).toBeUndefined()
  })

  it('floats an issue with an Urgent review to the top of Fix first', () => {
    const { read } = assembleGuestVoiceV2(
      input({
        current: [
          ...many(5, () => review(1, [complaint(SHOWER, 'facilities_equipment')])),
          ...many(3, () => review(4, [complaint(AC, 'facilities_equipment')])),
          review(4, [complaint(AC, 'facilities_equipment')], { urgentReason: 'health' }),
        ],
      }),
    )

    expect(read.fixFirst.map((item) => item.issueId)).toEqual([AC, SHOWER])
    expect(read.fixFirst[0]?.urgentReason).toBe('health')
  })

  it('shows the most severe reason when one issue has Urgent reviews of several kinds', () => {
    const { read } = assembleGuestVoiceV2(
      input({
        current: [
          review(1, [complaint(AC, 'facilities_equipment')], {
            urgentReason: 'legal_threat',
          }),
          review(1, [complaint(AC, 'facilities_equipment')], { urgentReason: 'safety' }),
        ],
      }),
    )

    expect(read.urgent).toHaveLength(1)
    expect(read.urgent[0]?.urgentReason).toBe('safety')
  })

  it('does not drop an Urgent review that names no problem: it is counted as other', () => {
    const { read } = assembleGuestVoiceV2(
      input({
        current: [
          review(1, [], { urgentReason: 'legal_threat' }),
          review(1, [praise(STAFF, 'staff_service')], { urgentReason: 'discrimination' }),
        ],
      }),
    )

    expect(read.urgent).toEqual([])
    expect(read.urgentOtherCount).toBe(2)
  })

  it('keeps an Urgent review visible when a manager has hidden its issue', () => {
    const hiddenGroups = new Map(GROUPS)
    hiddenGroups.set(
      RAILING,
      group(RAILING, 'safety', 'balcony railing', { hidden: true }),
    )
    const { read } = assembleGuestVoiceV2(
      input({
        groups: hiddenGroups,
        current: [
          review(1, [complaint(RAILING, 'safety', 'loose')], { urgentReason: 'safety' }),
        ],
      }),
    )

    expect(read.urgent.map((item) => item.issueId)).toEqual([RAILING])
    expect(read.watch).toMatchObject([])
  })

  it('reports the moves the engine calls likely, bad news before good', () => {
    // 60 analysed reviews in the window against 480 in the 12 months before: complaints
    // about the air conditioning rose, praise for staff fell, complaints about the
    // shower all but stopped.
    const before = many(480, (index) =>
      review(
        5,
        index < 24
          ? [complaint(AC, 'facilities_equipment')]
          : index < 84
            ? [complaint(SHOWER, 'facilities_equipment')]
            : [praise(STAFF, 'staff_service')],
      ),
    )
    const current = [
      ...many(20, () =>
        review(2, [complaint(AC, 'facilities_equipment', 'not working')]),
      ),
      ...many(40, (index) =>
        review(5, index < 20 ? [praise(STAFF, 'staff_service')] : []),
      ),
    ]
    const { read } = assembleGuestVoiceV2(
      input({
        currentPopulation: [],
        population: { stars: [0, 20, 0, 0, 40], textReviews: 60 },
        current,
        baseline: before,
      }),
    )

    expect(
      read.whatChanged.map((item) => [item.issueId, item.change, item.polarity]),
    ).toEqual([
      [AC, 'rising', 'complaint'],
      [STAFF, 'falling', 'praise'],
    ])
    expect(read.whatChanged.every((item) => item.evidenceLevel === 'likely')).toBe(true)
    expect(read.inShort.map((line) => line.kind)).toEqual([
      'fix_first',
      'protect',
      'change',
    ])
  })

  it('reports a problem that eased as good news, once it still has four reviews to stand on', () => {
    const before = many(480, (index) =>
      review(5, index < 120 ? [complaint(SHOWER, 'facilities_equipment')] : []),
    )
    const current = [
      ...many(4, () => review(2, [complaint(SHOWER, 'facilities_equipment')])),
      ...many(56, () => review(5, [])),
    ]
    const { read } = assembleGuestVoiceV2(
      input({
        currentPopulation: [],
        population: { stars: [0, 4, 0, 0, 56], textReviews: 60 },
        current,
        baseline: before,
      }),
    )

    expect(
      read.whatChanged.map((item) => [item.issueId, item.change, item.polarity]),
    ).toEqual([[SHOWER, 'falling', 'complaint']])
  })

  it('does not report a move for a problem the window names in fewer than four reviews', () => {
    const before = many(480, (index) =>
      review(5, index < 120 ? [complaint(SHOWER, 'facilities_equipment')] : []),
    )
    const current = [
      ...many(2, () => review(2, [complaint(SHOWER, 'facilities_equipment')])),
      ...many(58, () => review(5, [])),
    ]
    const { read } = assembleGuestVoiceV2(
      input({
        currentPopulation: [],
        population: { stars: [0, 2, 0, 0, 58], textReviews: 60 },
        current,
        baseline: before,
      }),
    )

    expect(read.whatChanged).toEqual([])
  })

  it('claims no change while reviews are still being analysed', () => {
    const baselineReviews = many(480, (index) =>
      review(
        5,
        index < 24
          ? [complaint(AC, 'facilities_equipment')]
          : [praise(STAFF, 'staff_service')],
      ),
    )
    const current = [
      ...many(20, () => review(2, [complaint(AC, 'facilities_equipment')])),
      ...many(40, () => review(5, [praise(STAFF, 'staff_service')])),
    ]
    const { read } = assembleGuestVoiceV2(
      input({
        provisional: true,
        currentPopulation: [],
        population: { stars: [0, 20, 0, 0, 40], textReviews: 60 },
        current,
        baseline: baselineReviews,
      }),
    )

    expect(read.provisional).toBe(true)
    expect(read.whatChanged).toEqual([])
    expect(read.fixFirst[0]?.statistics.change).toBe('unknown')
    expect(read.inShort.map((line) => line.kind)).toEqual(['fix_first', 'protect'])
  })

  it('reports every topic named, the most named first, with praise, complaint and neutral reviews', () => {
    const neutral: MentionSpec = {
      group: BREAKFAST,
      topic: 'food_drink',
      polarity: 'neutral',
    }
    const { read } = assembleGuestVoiceV2(
      input({
        current: [
          review(5, [
            praise(STAFF, 'staff_service'),
            complaint(AC, 'facilities_equipment'),
          ]),
          review(4, [praise(STAFF, 'staff_service')]),
          review(3, [neutral]),
          review(2, [
            complaint(AC, 'facilities_equipment'),
            praise(AC, 'facilities_equipment'),
          ]),
        ],
      }),
    )

    expect(
      read.everyTopic
        .filter((row) => row.statistics.reviewCount > 0)
        .map((row) => [
          row.topic,
          row.praiseReviews,
          row.complaintReviews,
          row.neutralReviews,
          row.statistics.reviewCount,
        ]),
    ).toEqual([
      ['staff_service', 2, 0, 0, 2],
      ['food_drink', 0, 0, 1, 1],
      ['facilities_equipment', 1, 2, 0, 2],
    ])
  })

  it('states what the window holds, and counts the reviews with only stars', () => {
    const { read } = assembleGuestVoiceV2(input())

    expect(read).toMatchObject({
      status: 'ready',
      readModelVersion: 'guest-voice-read-v2',
      statisticsVersion: 'guest-voice-statistics-v2',
      window: '90d',
      startLocalDate: '2026-08-02',
      endLocalDate: '2026-10-30',
      dataThroughLocalDate: '2026-10-30',
      basis: { textReviewCount: 40, starOnlyCount: 20 },
      fixFirst: [],
      watch: [],
      guestsLove: [],
      whatChanged: [],
      inShort: [],
      staffPraise: null,
    })
  })

  it('offers no review that names a person as a quote, and none for a topic-level issue it does not name', () => {
    const named = review(2, [
      { ...complaint(AC, 'facilities_equipment', 'not working'), namesPerson: 'other' },
    ])
    const clean = review(2, [complaint(AC, 'facilities_equipment', 'not working')])
    const { evidence } = assembleGuestVoiceV2(
      input({
        current: [named, clean, review(3, [complaint(AC, 'facilities_equipment')])],
      }),
    )

    const slot = evidence.find(
      (entry) => entry.section === 'fixFirst' && entry.issueId === AC,
    )
    expect(slot?.candidates.map((candidate) => candidate.reviewId)).not.toContain(
      named.reviewId,
    )
    expect(slot?.candidates).toHaveLength(2)
  })

  it('keeps a review out of every quote when the mention that named a person was set aside', () => {
    // A manager removed the staff mention that carried the name, so the mentions left
    // name no one; the review's text still holds the name, and a quote shows it whole.
    const setAside = review(
      1,
      [
        complaint(RAILING, 'safety', 'loose', 'strong'),
        complaint(AC, 'facilities_equipment', 'not working'),
      ],
      { urgentReason: 'safety', namesAPerson: true },
    )
    const clean = [1, 2].map(() =>
      review(1, [complaint(AC, 'facilities_equipment', 'not working')]),
    )
    const { evidence } = assembleGuestVoiceV2(input({ current: [setAside, ...clean] }))

    // Three reviews complain of the air conditioning, so it is in Fix first; the one whose
    // name was set aside still counts, and is not among the reviews put forward to quote.
    const fixFirst = evidence.find(
      (entry) => entry.section === 'fixFirst' && entry.issueId === AC,
    )
    expect(fixFirst?.candidates.map((candidate) => candidate.reviewId).sort()).toEqual(
      clean.map((entry) => entry.reviewId).sort(),
    )
    const urgent = evidence.find((entry) => entry.section === 'urgent')
    expect(urgent).toBeDefined()
    expect(urgent?.candidates).toEqual([])
  })

  it('offers the strongest, then the most recent review as the quote, at most three', () => {
    const mild = review(2, [complaint(AC, 'facilities_equipment', null, 'mild')], {
      localDate: '2026-10-28',
    })
    const strongOld = review(2, [complaint(AC, 'facilities_equipment', null, 'strong')], {
      localDate: '2026-09-01',
    })
    const strongNew = review(2, [complaint(AC, 'facilities_equipment', null, 'strong')], {
      localDate: '2026-10-20',
    })
    const clear = review(2, [complaint(AC, 'facilities_equipment', null, 'clear')])
    const { evidence } = assembleGuestVoiceV2(
      input({ current: [mild, strongOld, clear, strongNew] }),
    )

    const slot = evidence.find((entry) => entry.section === 'fixFirst')
    expect(slot?.candidates.map((candidate) => candidate.reviewId)).toEqual([
      strongNew.reviewId,
      strongOld.reviewId,
      clear.reviewId,
    ])
    expect(slot?.candidates[0]).toMatchObject({
      reviewedAt: '2026-10-20',
      rating: 2,
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: expect.any(Number),
      sentenceNumbers: [],
    })
  })

  it('gives each Urgent card the Urgent review that reported it as its quote', () => {
    const urgent = review(1, [complaint(RAILING, 'safety', 'loose')], {
      urgentReason: 'safety',
    })
    const other = review(1, [complaint(RAILING, 'safety', 'loose', 'strong')])
    const { evidence } = assembleGuestVoiceV2(input({ current: [other, urgent] }))

    const slot = evidence.find((entry) => entry.section === 'urgent')
    expect(slot?.issueId).toBe(RAILING)
    expect(slot?.candidates.map((candidate) => candidate.reviewId)).toEqual([
      urgent.reviewId,
    ])
  })
})
