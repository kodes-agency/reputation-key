import type {
  GuestVoiceRatingMonth,
  GuestVoiceRatingTrend,
  GuestVoiceTopicStatus,
  GuestVoiceWindow,
  RatingTrendPeriod,
  ReviewTopicV3,
} from '#/contexts/ai/application/public-api'
import { formatNumber, formatLocalDate } from '#/lib/format'
import { monthLabel, reviewsPhrase, windowDates } from './guest-voice-words'

export const FRIENDLY_TOPICS: Readonly<Record<ReviewTopicV3, string>> = {
  staff_service: 'your team',
  speed_waiting: 'waiting times',
  booking_arrival: 'booking and arrival',
  main_service: 'the main service',
  food_drink: 'food and drink',
  cleanliness: 'cleanliness',
  facilities_equipment: 'the facilities',
  price_billing: 'prices',
  atmosphere_noise: 'the atmosphere',
  location_access: 'the location',
  safety: 'safety',
  communication: 'communication',
}
const SMALL_NUMBERS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
]
export function urgentAnswer(count: number): string {
  return `Yes — ${SMALL_NUMBERS[count] ?? formatNumber(count)} serious ${count === 1 ? 'concern' : 'concerns'}`
}
export function trendAnswer(verdict: GuestVoiceRatingTrend['verdict']): string {
  return {
    improving: 'Yes, it’s getting better',
    steady: 'About the same',
    slipping: 'It’s slipping',
    not_enough: 'Not enough reviews to compare yet',
  }[verdict]
}
function answer(
  items: readonly Readonly<{ topic: ReviewTopicV3 }>[],
  empty: string,
): string {
  const names = [...new Set(items.slice(0, 3).map((item) => FRIENDLY_TOPICS[item.topic]))]
  if (names.length === 0) return empty
  const joined =
    names.length < 2
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  return joined.charAt(0).toUpperCase() + joined.slice(1)
}
export const fixAnswer = (items: readonly Readonly<{ topic: ReviewTopicV3 }>[]) =>
  answer(items, 'No recurring concern stands out')
export const praiseAnswer = (items: readonly Readonly<{ topic: ReviewTopicV3 }>[]) =>
  answer(items, 'Not enough repeated praise to name yet')
export const otherConcernsLabel = (count: number) =>
  `${formatNumber(count)} other ${count === 1 ? 'concern' : 'concerns'} guests raised`
export const morePraiseLabel = (count: number) =>
  `${formatNumber(count)} more ${count === 1 ? 'thing' : 'things'} guests love`
export const lastReportedText = (day: string) =>
  `Last reported ${formatLocalDate(day, { year: false }) ?? day}`
export const lastMentionedText = (day: string) =>
  `last in ${monthLabel(day.slice(0, 7)).short}`
export function ratingComparisonLabels(period: RatingTrendPeriod): string {
  return `${windowDates(period.startLocalDate, period.endLocalDate)} · ${reviewsPhrase(period.reviewCount)}`
}
export function partialMonthText(point: GuestVoiceRatingMonth): string {
  const covered =
    point.partialStart || point.partialEnd
      ? ` · ${point.partialStart ? `from ${formatLocalDate(point.startLocalDate, { year: false })}` : ''}${point.partialStart && point.partialEnd ? ' ' : ''}${point.partialEnd ? `through ${formatLocalDate(point.endLocalDate, { year: false })}` : ''}`
      : ''
  return `${monthLabel(point.month).short}: ${reviewsPhrase(point.reviewCount)}${covered}`
}
export const topicStatusWords: Readonly<Record<GuestVoiceTopicStatus, string>> = {
  needs_attention: 'Needs attention',
  mixed: 'Mixed',
  doing_well: 'Doing well',
  great: 'Great',
  unjudged: 'Not enough reviews yet',
}
export const periodWords = (window: GuestVoiceWindow) =>
  ({
    '30d': 'the last 30 days',
    '90d': 'the last 90 days',
    '180d': 'the last 6 months',
    '365d': 'the last 12 months',
  })[window]
