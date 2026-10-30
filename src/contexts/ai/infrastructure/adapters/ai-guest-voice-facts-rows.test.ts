import { describe, expect, it } from 'vitest'
import { mapFactsRow, mapGroupRow, type FactsRow } from './ai-guest-voice-facts-rows'

const REVIEW_ID = '00000000-0000-4000-8000-000000000001'
const GROUP_ID = 'a0000000-0000-4000-8000-000000000001'

function row(over: Partial<FactsRow> = {}): FactsRow {
  return {
    reviewId: REVIEW_ID,
    sourceRevision: 1,
    analysisSequence: 4,
    localDate: '2026-10-05',
    rating: 2,
    status: 'ready',
    urgentReason: null,
    mentions: [
      {
        ordinal: 0,
        topic: 'facilities_equipment',
        polarity: 'negative',
        strength: 'clear',
        cause: 'not working',
        group: GROUP_ID,
        names: null,
      },
    ],
    ...over,
  }
}

describe('mapFactsRow', () => {
  it('reads a ready review with its mentions', () => {
    expect(mapFactsRow(row({ urgentReason: 'safety' }), 3)).toEqual({
      kind: 'ready',
      review: {
        reviewId: REVIEW_ID,
        sourceEpoch: 3,
        sourceRevision: 1,
        analysisSequence: 4,
        localDate: '2026-10-05',
        rating: 2,
        urgentReason: 'safety',
        mentions: [
          {
            mentionOrdinal: 0,
            topic: 'facilities_equipment',
            polarity: 'negative',
            strength: 'clear',
            cause: 'not working',
            issueGroupId: GROUP_ID,
            namesPerson: null,
          },
        ],
      },
    })
  })

  it('reads versions that arrive as text, as a float8 cast may', () => {
    const mapped = mapFactsRow(row({ sourceRevision: '2', analysisSequence: '9' }), 0)

    expect(mapped.kind === 'ready' && mapped.review).toMatchObject({
      sourceRevision: 2,
      analysisSequence: 9,
    })
  })

  it('reads a review the analysis could not read as only its version and day', () => {
    expect(mapFactsRow(row({ status: 'unavailable', mentions: [] }), 0)).toEqual({
      kind: 'unavailable',
      review: {
        reviewId: REVIEW_ID,
        sourceRevision: 1,
        analysisSequence: 4,
        localDate: '2026-10-05',
      },
    })
  })

  it.each([
    ['a status the table never holds', { status: 'pending' }],
    ['a rating outside one to five', { rating: 7 }],
    ['an Urgent reason outside the four', { urgentReason: 'fire' }],
    ['a negative version', { sourceRevision: -1 }],
    [
      'a topic outside the twelve',
      {
        mentions: [
          {
            ordinal: 0,
            topic: 'pool',
            polarity: 'negative',
            strength: 'clear',
            cause: null,
            group: null,
            names: null,
          },
        ],
      },
    ],
    [
      'a mention with an unknown field',
      {
        mentions: [
          {
            ordinal: 0,
            topic: 'safety',
            polarity: 'negative',
            strength: 'clear',
            cause: null,
            group: null,
            names: null,
            text: 'a quote',
          },
        ],
      },
    ],
  ] as const)('refuses %s', (_name, over) => {
    expect(() => mapFactsRow(row(over as Partial<FactsRow>), 0)).toThrow()
  })
})

describe('mapGroupRow', () => {
  it('reads an issue', () => {
    expect(
      mapGroupRow({
        id: GROUP_ID,
        topic: 'safety',
        canonicalThing: 'balcony railing',
        displayName: null,
        hidden: true,
      }),
    ).toEqual({
      id: GROUP_ID,
      topic: 'safety',
      canonicalThing: 'balcony railing',
      displayName: null,
      hidden: true,
    })
  })

  it('refuses a topic outside the twelve', () => {
    expect(() =>
      mapGroupRow({
        id: GROUP_ID,
        topic: 'pool',
        canonicalThing: null,
        displayName: null,
        hidden: false,
      }),
    ).toThrow()
  })
})
