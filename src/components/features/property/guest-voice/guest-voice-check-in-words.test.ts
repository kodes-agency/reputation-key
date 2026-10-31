import { describe, expect, it } from 'vitest'
import { REVIEW_TOPICS_V3 } from '#/shared/review-topic-taxonomy'
import {
  FRIENDLY_TOPICS,
  fixAnswer,
  praiseAnswer,
  urgentAnswer,
  trendAnswer,
  otherConcernsLabel,
  morePraiseLabel,
  lastReportedText,
  lastMentionedText,
  ratingComparisonLabels,
  partialMonthText,
  topicStatusWords,
  periodWords,
} from './guest-voice-check-in-words'
import { HAMPTON_READ } from './guest-voice-fixtures-check-in'

describe('friendly check-in answers', () => {
  it('covers every one of the twelve topics with the approved phrase', () => {
    expect(REVIEW_TOPICS_V3.map((topic) => FRIENDLY_TOPICS[topic])).toEqual([
      'your team',
      'waiting times',
      'booking and arrival',
      'the main service',
      'food and drink',
      'cleanliness',
      'the facilities',
      'prices',
      'the atmosphere',
      'the location',
      'safety',
      'communication',
    ])
  })
  it('takes the first three ranked items, then deduplicates topics in rank order', () => {
    expect(
      fixAnswer([
        { topic: 'cleanliness' },
        { topic: 'cleanliness' },
        { topic: 'price_billing' },
        { topic: 'safety' },
      ]),
    ).toBe('Cleanliness and prices')
    expect(
      praiseAnswer([
        { topic: 'staff_service' },
        { topic: 'location_access' },
        { topic: 'food_drink' },
      ]),
    ).toBe('Your team, the location and food and drink')
    expect(fixAnswer([])).toBe('No recurring concern stands out')
    expect(praiseAnswer([])).toBe('Not enough repeated praise to name yet')
  })
  it('counts concern groups, with singular words and numbers from ten', () => {
    expect(urgentAnswer(1)).toBe('Yes — one serious concern')
    expect(urgentAnswer(2)).toBe('Yes — two serious concerns')
    expect(urgentAnswer(10)).toBe('Yes — 10 serious concerns')
    expect(otherConcernsLabel(1)).toBe('1 other concern guests raised')
    expect(otherConcernsLabel(5)).toBe('5 other concerns guests raised')
    expect(morePraiseLabel(1)).toBe('1 more thing guests love')
    expect(morePraiseLabel(4)).toBe('4 more things guests love')
  })
  it('has a factual answer for every trend verdict', () => {
    expect(
      ['improving', 'steady', 'slipping', 'not_enough'].map((v) =>
        trendAnswer(v as Parameters<typeof trendAnswer>[0]),
      ),
    ).toEqual([
      'Yes, it’s getting better',
      'About the same',
      'It’s slipping',
      'Not enough reviews to compare yet',
    ])
  })
  it('states exact comparison dates, counts and partial-month coverage', () => {
    expect(lastReportedText('2026-09-12')).toBe('Last reported Sep 12')
    expect(lastMentionedText('2026-09-12')).toBe('last in Sep')
    expect(ratingComparisonLabels(HAMPTON_READ.ratingTrend.recent)).toContain('reviews')
    const point = HAMPTON_READ.ratingTrend.months.at(-1)
    if (!point) throw new Error('Dated fixture needs a final month')
    expect(partialMonthText(point)).toBe('Oct: 1 review · through Oct 1')
    expect(periodWords('365d')).toBe('the last 12 months')
    expect(topicStatusWords.unjudged).toBe('Not enough reviews yet')
  })
})
