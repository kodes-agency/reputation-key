// What Guest voice 2.0 says, as plain functions: the labels of the twelve topics, the
// way a figure is worded, the sentence that names the window. A component draws these
// and decides nothing about them, so each is tested by itself.
import type {
  GuestVoiceWindow,
  ReviewTopicV3,
} from '#/contexts/ai/application/public-api'
import {
  formatDate,
  formatLocalDate,
  formatMonthName,
  formatMonthYear,
  formatNumber,
} from '#/lib/format'
import { RANGE_PRESET_LABELS, type GuestVoiceRange } from '#/shared/dashboard-range'
import { REVIEW_TOPIC_LABELS_V3 } from '#/shared/review-topic-taxonomy'

export function topicLabel(topic: ReviewTopicV3): string {
  return REVIEW_TOPIC_LABELS_V3[topic]
}

/** "1 review", "19 reviews". */
export function reviewsPhrase(count: number): string {
  return `${formatNumber(count)} ${count === 1 ? 'review' : 'reviews'}`
}

/** "2.1★": the glyph is drawn for the eye, and the sentence is read in words. */
export function starsText(value: number): string {
  return `${value.toFixed(1)}★`
}

export type ChangeSense = 'complaint' | 'praise'

const WINDOW_NAMES: Readonly<Record<GuestVoiceWindow, string>> = {
  '30d': RANGE_PRESET_LABELS['30d'].toLowerCase(),
  '90d': RANGE_PRESET_LABELS['90d'].toLowerCase(),
  '180d': RANGE_PRESET_LABELS['180d'].toLowerCase(),
  '365d': RANGE_PRESET_LABELS['365d'].toLowerCase(),
}

/** How few reviews with text leave a short window with nothing to say about patterns. */
const SPARSE_WINDOW_REVIEWS = 10

/** The reviews with text the automatic window aims to hold (`chooseEvidenceWindow`). */
const AUTOMATIC_TARGET = 60

/**
 * One sentence naming the window and why it is that one:
 * "Last 90 days, chosen because it holds 128 reviews with text (plus 96 without text)."
 */
export function windowSentence({
  range,
  window,
  textReviewCount,
  starOnlyCount,
}: Readonly<{
  range: GuestVoiceRange
  window: GuestVoiceWindow
  textReviewCount: number
  starOnlyCount: number
}>): string {
  const period = `Last ${WINDOW_NAMES[window]}`
  const holds =
    textReviewCount === 0
      ? 'no reviews with text'
      : `${reviewsPhrase(textReviewCount)} with text`
  const without =
    starOnlyCount > 0 ? ` (plus ${formatNumber(starOnlyCount)} without text)` : ''
  if (range !== 'auto') {
    const sparse =
      textReviewCount < SPARSE_WINDOW_REVIEWS ? ' That is too few to spot patterns.' : ''
    return `${period}. It holds ${holds}${without}.${sparse}`
  }
  // 12 months is where the choice stops: no shorter period held enough.
  return window === '365d' && textReviewCount < AUTOMATIC_TARGET
    ? `${period}, chosen because no shorter period holds enough reviews with text. It holds ${holds}${without}.`
    : `${period}, chosen because it holds ${holds}${without}.`
}

/** "Jul 31 to Oct 29, 2026": the days the window covers. */
export function windowDates(startLocalDate: string, endLocalDate: string): string | null {
  const start = formatLocalDate(startLocalDate, { year: false })
  const end = formatLocalDate(endLocalDate)
  return start === null || end === null ? null : `${start} to ${end}`
}

const LOCAL_DAY = /^\d{4}-\d{2}-\d{2}$/u

/** The day a review was left: "Oct 18, 2026", from a day or an instant. */
export function reviewDay(reviewedAt: string): string | null {
  return LOCAL_DAY.test(reviewedAt) ? formatLocalDate(reviewedAt) : formatDate(reviewedAt)
}

/** "Oct" labels a bar and "October 2026" names it, from a series month such as `2026-10`. */
export function monthLabel(month: string): Readonly<{ short: string; long: string }> {
  const first = `${month}-01T00:00:00.000Z`
  const name = formatMonthName(first)
  return {
    short: name === null ? month : name.slice(0, 3),
    long: formatMonthYear(first) ?? month,
  }
}
