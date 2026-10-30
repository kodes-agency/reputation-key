import { describe, expect, it } from 'vitest'
import type {
  FixFirstItem,
  GuestVoiceV2NotEnough,
  GuestVoiceV2Ready,
} from './guest-voice-v2'
import {
  liveEvidenceOf,
  withLiveEvidence,
  type EvidenceCandidate,
  type EvidenceSlot,
  type GuestVoiceV2Draft,
  type ResolvedReview,
} from './guest-voice-v2-evidence'
import { issueStatistics } from './issue-statistics'

const TEXT =
  'Lovely room with a view. The air conditioning did not work for two nights!\nNobody came to fix it. Breakfast was fine.'

function candidate(over: Partial<EvidenceCandidate> = {}): EvidenceCandidate {
  return {
    reviewId: 'r-1',
    mentionOrdinal: 0,
    reviewedAt: '2026-10-18',
    rating: 2,
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: 4,
    sentenceNumbers: [2],
    ...over,
  }
}

/** A review as the delivery layer found it, at the revision the candidates are made on. */
const opened = (
  text: string | null,
  inboxItemId = 'item-1',
  sourceRevision: number | null = 1,
): ResolvedReview => ({
  inboxItemId,
  text,
  sourceRevision,
})

describe('liveEvidenceOf', () => {
  it('underlines the sentences the analysis cites, cut by the rule the analysis used', () => {
    const quote = liveEvidenceOf(candidate({ sentenceNumbers: [2, 3] }), opened(TEXT))

    expect(quote).not.toBeNull()
    const ranges = quote?.sentenceRanges ?? []
    expect(ranges.map(({ start, end }) => TEXT.slice(start, end))).toEqual([
      'The air conditioning did not work for two nights!',
      'Nobody came to fix it.',
    ])
    expect(quote).toMatchObject({
      inboxItemId: 'item-1',
      reviewedAt: '2026-10-18',
      rating: 2,
      text: TEXT,
    })
  })

  it('puts the ranges in reading order whatever order the sentences were cited in', () => {
    const quote = liveEvidenceOf(candidate({ sentenceNumbers: [4, 1] }), opened(TEXT))

    expect(
      (quote?.sentenceRanges ?? []).map(({ start, end }) => TEXT.slice(start, end)),
    ).toEqual(['Lovely room with a view.', 'Breakfast was fine.'])
  })

  it('has no quote when the text cannot be read, so the card shows its figures alone', () => {
    expect(liveEvidenceOf(candidate(), undefined)).toBeNull()
    expect(liveEvidenceOf(candidate(), opened(null))).toBeNull()
  })

  // S2: the sentence numbers an analysis cites count the sentences of the text it read.
  // A review edited since is another text, and the same numbers can point at other
  // sentences, so a quote needs the revision the analysis was made on.
  it('has no quote when the review is not at the revision the analysis was made on', () => {
    const edited = TEXT.replace('Lovely room', 'Dreadful room')
    for (const current of [2, 7]) {
      expect(
        liveEvidenceOf(
          candidate({ sourceRevision: 1 }),
          opened(edited, 'item-1', current),
        ),
      ).toBeNull()
    }
    // And the revision is not the only thing that decides: the same revision with
    // fewer sentences than were numbered is still no quote.
    expect(
      liveEvidenceOf(
        candidate({ sentenceNumbers: [6] }),
        opened('Good. Fine.', 'item-1', 1),
      ),
    ).toBeNull()
  })

  it('has no quote for a review whose revision was not read', () => {
    expect(liveEvidenceOf(candidate(), opened(TEXT, 'item-1', null))).toBeNull()
  })

  it('quotes a review at the revision the analysis was made on', () => {
    expect(
      liveEvidenceOf(
        candidate({ sourceRevision: 4, sentenceNumbers: [2] }),
        opened(TEXT, 'item-1', 4),
      ),
    ).not.toBeNull()
  })

  it('has no quote when the review now has fewer sentences than the analysis numbered', () => {
    expect(
      liveEvidenceOf(candidate({ sentenceNumbers: [6] }), opened('Good. Fine.')),
    ).toBeNull()
  })

  it('has no quote when the analysis cited no sentence', () => {
    expect(liveEvidenceOf(candidate({ sentenceNumbers: [] }), opened(TEXT))).toBeNull()
  })

  it('refuses a sentence number below one', () => {
    expect(liveEvidenceOf(candidate({ sentenceNumbers: [0] }), opened(TEXT))).toBeNull()
    expect(liveEvidenceOf(candidate({ sentenceNumbers: [-1] }), opened(TEXT))).toBeNull()
  })
})

const STATISTICS = issueStatistics(
  { textReviews: 40, allReviews: 60, stars: [4, 6, 8, 18, 24], baselineReviews: 0 },
  { stars: [1, 1, 1, 0, 0] },
)

function item(issueId: string): FixFirstItem {
  return {
    issueId,
    title: 'Air conditioning',
    topic: 'facilities_equipment',
    causes: [],
    urgentReason: null,
    statistics: STATISTICS,
  }
}

function ready(over: Partial<GuestVoiceV2Ready> = {}): GuestVoiceV2Ready {
  return {
    status: 'ready',
    readModelVersion: 'guest-voice-read-v2',
    statisticsVersion: 'guest-voice-statistics-v2',
    window: '90d',
    startLocalDate: '2026-08-02',
    endLocalDate: '2026-10-30',
    dataThroughLocalDate: '2026-10-30',
    provisional: false,
    basis: { textReviewCount: 40, starOnlyCount: 20 },
    inShort: [],
    urgent: [],
    fixFirst: [],
    guestsLove: [],
    staffPraise: null,
    watch: [],
    whatChanged: [],
    everyTopic: [],
    ...over,
  }
}

function slot(
  section: EvidenceSlot['section'],
  issueId: string,
  candidates: readonly EvidenceCandidate[],
): EvidenceSlot {
  return { section, issueId, candidates }
}

describe('withLiveEvidence', () => {
  it('quotes each card with the first of its reviews whose text can be read', () => {
    const draft: GuestVoiceV2Draft = {
      read: ready({ fixFirst: [item('issue-1')] }),
      evidence: [
        slot('fixFirst', 'issue-1', [
          candidate({ reviewId: 'gone' }),
          candidate({ reviewId: 'readable', rating: 1 }),
          candidate({ reviewId: 'later' }),
        ]),
      ],
      latest: [],
    }

    const read = withLiveEvidence(
      draft,
      new Map([
        ['readable', opened(TEXT, 'item-9')],
        ['later', opened(TEXT, 'item-10')],
      ]),
    )

    expect(read.status).toBe('ready')
    const quote = read.status === 'ready' ? read.fixFirst[0]?.quote : undefined
    expect(quote).toMatchObject({ inboxItemId: 'item-9', rating: 1 })
  })

  it('leaves a card with no quote when none of its reviews can be read', () => {
    const draft: GuestVoiceV2Draft = {
      read: ready({ fixFirst: [item('issue-1')] }),
      evidence: [slot('fixFirst', 'issue-1', [candidate({ reviewId: 'gone' })])],
      latest: [],
    }

    const read = withLiveEvidence(draft, new Map())

    expect(read.status === 'ready' ? read.fixFirst[0]?.quote : 'not ready').toBeNull()
  })

  it('keeps the same issue in two sections apart', () => {
    const draft: GuestVoiceV2Draft = {
      read: ready({
        urgent: [item('issue-1')],
        fixFirst: [item('issue-1')],
        guestsLove: [
          {
            issueId: 'issue-1',
            title: 'Air conditioning',
            topic: 'facilities_equipment',
            statistics: STATISTICS,
          },
        ],
      }),
      evidence: [
        slot('urgent', 'issue-1', [candidate({ reviewId: 'urgent-one' })]),
        slot('fixFirst', 'issue-1', [candidate({ reviewId: 'complaint-one' })]),
        slot('guestsLove', 'issue-1', [candidate({ reviewId: 'praise-one', rating: 5 })]),
      ],
      latest: [],
    }

    const read = withLiveEvidence(
      draft,
      new Map([
        ['urgent-one', opened(TEXT, 'item-u')],
        ['complaint-one', opened(TEXT, 'item-c')],
        ['praise-one', opened(TEXT, 'item-p')],
      ]),
    )

    if (read.status !== 'ready') throw new Error('expected a ready page')
    expect(read.urgent[0]?.quote?.inboxItemId).toBe('item-u')
    expect(read.fixFirst[0]?.quote?.inboxItemId).toBe('item-c')
    expect(read.guestsLove[0]?.quote?.inboxItemId).toBe('item-p')
  })

  it('lists a young Property’s latest reviews, with words only where the analysis allows them', () => {
    const notEnough: GuestVoiceV2NotEnough = {
      status: 'not_enough_reviews',
      readModelVersion: 'guest-voice-read-v2',
      textReviewCount: 4,
      latestReviews: [],
    }
    const draft: GuestVoiceV2Draft = {
      read: notEnough,
      evidence: [],
      latest: [
        {
          reviewId: 'plain',
          reviewedAt: '2026-10-28',
          rating: 5,
          mayShowText: true,
          sourceRevision: 1,
        },
        {
          reviewId: 'names-someone',
          reviewedAt: '2026-10-27',
          rating: 4,
          mayShowText: false,
          sourceRevision: 1,
        },
        {
          reviewId: 'cannot-open',
          reviewedAt: '2026-10-26',
          rating: 3,
          mayShowText: true,
          sourceRevision: 1,
        },
        {
          // Edited after it was counted and checked for names: listed, without words.
          reviewId: 'edited-since',
          reviewedAt: '2026-10-25',
          rating: 2,
          mayShowText: true,
          sourceRevision: 1,
        },
      ],
    }

    const read = withLiveEvidence(
      draft,
      new Map([
        ['plain', opened('Great stay.', 'item-a')],
        ['names-someone', opened('Maria was lovely.', 'item-b')],
        ['edited-since', opened('Now it names Maria.', 'item-d', 2)],
      ]),
    )

    expect(read).toEqual({
      ...notEnough,
      latestReviews: [
        {
          inboxItemId: 'item-a',
          reviewedAt: '2026-10-28',
          rating: 5,
          text: 'Great stay.',
        },
        { inboxItemId: 'item-b', reviewedAt: '2026-10-27', rating: 4, text: null },
        { inboxItemId: 'item-d', reviewedAt: '2026-10-25', rating: 2, text: null },
      ],
    })
  })
})
