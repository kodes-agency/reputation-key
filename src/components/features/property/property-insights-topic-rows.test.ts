import { describe, expect, it } from 'vitest'
import type {
  AiPropertyInsightAspect,
  AiPropertyInsightsPresetReady,
} from '#/contexts/ai/application/public-api'
import { LARGE_PROPERTY, SMALL_PROPERTY } from './property-guest-voice-stories-data'
import {
  complaintStars,
  reviewsText,
  topicChanges,
  topicRows,
  type TopicRow,
} from './property-insights-topic-rows'

function row(over: Partial<TopicRow> = {}): TopicRow {
  return {
    aspect: 'room',
    label: 'Room',
    reviews: 10,
    praise: undefined,
    complaints: undefined,
    ...over,
  }
}

function entry(over: Partial<AiPropertyInsightAspect>): AiPropertyInsightAspect {
  return {
    aspect: 'room',
    polarity: 'negative',
    mentionCount: 5,
    reviewCount: 5,
    topicReviewCount: 5,
    ratingCounts: [0, 2, 2, 1, 0],
    stars: { mentionedAverage: 2.8, othersAverage: 4.4, gap: 1.6, upTo: 0.1 },
    change: 'unknown',
    ...over,
  }
}

describe('topicRows', () => {
  it('orders the topics by the stars at stake in their complaints', () => {
    const rows = topicRows(LARGE_PROPERTY)

    // Service first: 19 reviews that rated 2.0 stars against 4.2 for the rest.
    expect(rows[0]?.aspect).toBe('service')
    expect(rows.slice(0, 3).map((topic) => topic.aspect)).toEqual([
      'service',
      'room',
      'wait_time',
    ])
  })

  it('puts a topic nobody complains about after every topic that has complaints, most praised first', () => {
    const rows = topicRows(LARGE_PROPERTY)
    const praiseOnly = rows.filter((topic) => topic.complaints === undefined)

    expect(rows.slice(-praiseOnly.length)).toEqual(praiseOnly)
    expect(praiseOnly.map((topic) => topic.aspect)).toEqual([
      'cleanliness',
      'staff',
      'food_and_drink',
      'value',
      'amenities',
      'location',
      'quality',
    ])
  })

  it('puts complaints too few to weigh after complaints that were weighed and found worth nothing', () => {
    const weighedAtNothing = entry({
      aspect: 'noise',
      reviewCount: 3,
      stars: { mentionedAverage: 5, othersAverage: 4, gap: -1, upTo: 0 },
    })
    const tooFew = entry({
      aspect: 'parking',
      reviewCount: 2,
      stars: { mentionedAverage: 1, othersAverage: 4, gap: 3, upTo: null },
    })

    const evidence = {
      ...LARGE_PROPERTY,
      aspects: [
        { ...tooFew, comparison: { precedingMentionCount: 0, precedingReviewCount: 0 } },
        {
          ...weighedAtNothing,
          comparison: { precedingMentionCount: 0, precedingReviewCount: 0 },
        },
      ],
    } as AiPropertyInsightsPresetReady
    const rows = topicRows(evidence)

    expect(rows.map((topic) => topic.aspect)).toEqual(['noise', 'parking'])
  })

  it('leaves out a topic no review names in the window, one only the period before named', () => {
    const vanished = {
      ...entry({ aspect: 'noise', reviewCount: 0, topicReviewCount: 0 }),
      comparison: { precedingMentionCount: 4, precedingReviewCount: 4 },
    }
    const evidence = {
      ...LARGE_PROPERTY,
      aspects: [...LARGE_PROPERTY.aspects, vanished],
    } as AiPropertyInsightsPresetReady

    const rows = topicRows(evidence)

    expect(rows.some((topic) => topic.aspect === 'noise' && topic.reviews === 0)).toBe(
      false,
    )
    expect(rows).toHaveLength(topicRows(LARGE_PROPERTY).length)
  })

  it('takes a topic’s reviews from the reviews that name it, not from its rows', () => {
    const room = topicRows(LARGE_PROPERTY).find((topic) => topic.aspect === 'room')

    // 17 complain and 9 praise, and one review does both: 25 reviews.
    expect(room?.reviews).toBe(25)
    expect(room?.complaints?.reviewCount).toBe(17)
    expect(room?.praise?.reviewCount).toBe(9)
  })
})

describe('reviewsText', () => {
  it('says how many of the reviews read for topics name the topic', () => {
    expect(reviewsText(row({ reviews: 19 }), 128)).toBe('19 of 128')
    expect(reviewsText(row({ reviews: 1 }), 1_204)).toBe('1 of 1,204')
  })
})

describe('complaintStars', () => {
  it('prints the stars of the complaining reviews and of the rest to one decimal', () => {
    const service = topicRows(LARGE_PROPERTY)[0]
    if (!service) throw new Error('expected a row')

    expect(complaintStars(service)).toEqual({
      kind: 'stars',
      complaining: '2.0',
      rest: '4.2',
    })
  })

  it('says "too few" under three complaining reviews rather than print an average of them', () => {
    const parking = topicRows(SMALL_PROPERTY).find((topic) => topic.aspect === 'parking')
    if (!parking) throw new Error('expected a row')

    expect(parking.complaints?.reviewCount).toBe(1)
    expect(complaintStars(parking)).toEqual({ kind: 'too_few' })
  })

  it('says "too few" for a topic under three reviews whatever its complaints say', () => {
    expect(
      complaintStars(row({ reviews: 2, complaints: entry({ reviewCount: 3 }) })),
    ).toEqual({ kind: 'too_few' })
  })

  it('has nothing to compare for a topic nobody complains about', () => {
    expect(complaintStars(row({ complaints: undefined }))).toEqual({ kind: 'none' })
    expect(complaintStars(row({ complaints: entry({ reviewCount: 0 }) }))).toEqual({
      kind: 'none',
    })
  })
})

describe('topicChanges', () => {
  it('says nothing for a steady or unknown change', () => {
    expect(topicChanges(row({ complaints: entry({ change: 'steady' }) }))).toEqual([])
    expect(topicChanges(row({ complaints: entry({ change: 'unknown' }) }))).toEqual([])
  })

  it('words a likely rise in complaints as bad news and a likely fall as good', () => {
    expect(topicChanges(row({ complaints: entry({ change: 'rising' }) }))).toEqual([
      { text: 'Complaints likely rising', tone: 'negative', direction: 'up' },
    ])
    expect(topicChanges(row({ complaints: entry({ change: 'falling' }) }))).toEqual([
      { text: 'Complaints likely falling', tone: 'positive', direction: 'down' },
    ])
  })

  it('words praise the other way round', () => {
    expect(
      topicChanges(row({ praise: entry({ polarity: 'positive', change: 'rising' }) })),
    ).toEqual([{ text: 'Praise likely rising', tone: 'positive', direction: 'up' }])
    expect(
      topicChanges(row({ praise: entry({ polarity: 'positive', change: 'falling' }) })),
    ).toEqual([{ text: 'Praise likely falling', tone: 'negative', direction: 'down' }])
  })

  it('says both when praise and complaints both moved', () => {
    expect(
      topicChanges(
        row({
          praise: entry({ polarity: 'positive', change: 'falling' }),
          complaints: entry({ change: 'rising' }),
        }),
      ).map((change) => change.text),
    ).toEqual(['Complaints likely rising', 'Praise likely falling'])
  })

  it('says nothing for a topic under three reviews', () => {
    expect(
      topicChanges(row({ reviews: 2, complaints: entry({ change: 'rising' }) })),
    ).toEqual([])
  })
})
