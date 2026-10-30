// What Guest voice 2.0 says, as plain functions: the labels of the twelve topics, the
// way a figure is worded, the sentence that names the window. A component draws these
// and decides nothing about them, so each is tested by itself.
import type {
  ChangedItem,
  GuestVoiceChange,
  GuestVoiceEvidenceLevel,
  GuestVoiceWindow,
  IssueStatistics,
  ReviewTopicV3,
  UrgentReasonV3,
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

const URGENT_REASON_WORDS: Readonly<Record<UrgentReasonV3, string>> = {
  safety: 'safety',
  health: 'health',
  discrimination: 'discrimination',
  legal_threat: 'legal threat',
}

export function topicLabel(topic: ReviewTopicV3): string {
  return REVIEW_TOPIC_LABELS_V3[topic]
}

/** "safety": the reason that follows "Urgent ·". */
export function urgentReasonWords(reason: UrgentReasonV3): string {
  return URGENT_REASON_WORDS[reason]
}

/** "1 review", "19 reviews". */
export function reviewsPhrase(count: number): string {
  return `${formatNumber(count)} ${count === 1 ? 'review' : 'reviews'}`
}

/** "2.1★": the glyph is drawn for the eye, and the sentence is read in words. */
export function starsText(value: number): string {
  return `${value.toFixed(1)}★`
}

/** "in 19 of 128 reviews". */
export function inReviewsText(statistics: IssueStatistics): string {
  return `in ${statistics.shareText} reviews`
}

/** The stars of the reviews that name it, next to everyone else's. */
export function averagesText(statistics: IssueStatistics): string | null {
  const { mentionedAverage, othersAverage } = statistics
  if (mentionedAverage === null) return null
  if (othersAverage === null) return `average ${starsText(mentionedAverage)}`
  return `those average ${starsText(mentionedAverage)}, the rest ${starsText(othersAverage)}`
}

/** The same figures read aloud, for the line the eye reads as glyphs. */
export function averagesSpoken(statistics: IssueStatistics): string | null {
  const { mentionedAverage, othersAverage } = statistics
  if (mentionedAverage === null) return null
  const own = `${mentionedAverage.toFixed(1)} stars on average`
  return othersAverage === null
    ? `Those reviews gave ${own}`
    : `Those reviews gave ${own}, the rest ${othersAverage.toFixed(1)} stars`
}

const AVERAGE_WORDS: Readonly<Record<GuestVoiceWindow, string>> = {
  '30d': '30-day',
  '90d': '90-day',
  '180d': '6-month',
  '365d': '12-month',
}

/**
 * "worth up to about 0.2★ on your 90-day average", or null where the engine has no
 * figure (under three reviews) or the reviews that name it rate no lower than the rest.
 */
export function worthUpToText(
  statistics: IssueStatistics,
  window: GuestVoiceWindow,
): string | null {
  const { upTo } = statistics
  if (upTo === null || upTo <= 0) return null
  // 0.2, 0.15, 0.05: the engine rounds to 0.05, so two places at most.
  const figure = upTo.toFixed(2).replace(/0$/u, '')
  return `worth up to about ${figure}★ on your ${AVERAGE_WORDS[window]} average`
}

export type ChangePill = Readonly<{
  label: string
  tone: 'positive' | 'warn' | 'negative' | 'neutral'
  direction: 'up' | 'down' | 'flat'
}>

/** What a rise or a fall means for a manager depends on whether it is praise or a problem. */
export type ChangeSense = 'complaint' | 'praise'

/**
 * The pill a change wears, in words, an arrow and a tone. A change is claimed as "likely
 * real" only on the evidence level that says so; fewer reviews than that is an early
 * signal. Nothing is drawn where the engine could not judge.
 */
export function changePill(
  change: GuestVoiceChange,
  evidence: GuestVoiceEvidenceLevel,
  sense: ChangeSense,
): ChangePill | null {
  if (change === 'unknown') return null
  if (change === 'steady') return { label: 'Steady', tone: 'neutral', direction: 'flat' }
  const strength = evidence === 'likely' ? 'likely real' : 'early signal'
  const rising = change === 'rising'
  const good = rising === (sense === 'praise')
  return {
    label: `${rising ? 'Rising' : 'Falling'}, ${strength}`,
    // Praise that falls is a worry, not a failure; a complaint that falls is good news.
    tone: good ? 'positive' : sense === 'praise' ? 'warn' : 'negative',
    direction: rising ? 'up' : 'down',
  }
}

/**
 * What a move is, said against the property's own previous 12 months, which is what the
 * engine compares with. The counts of those months are not part of the figure the page
 * holds, so the sentence says which way the share went and not by how much.
 */
export function changeSentence(item: ChangedItem): string {
  const { reviewCount, shareText } = item.statistics
  const praise = item.polarity === 'praise'
  if (reviewCount === 0) {
    return praise ? 'No review praises it now.' : 'No review complains about it now.'
  }
  const what = praise ? 'praise it' : 'complain about it'
  const often = item.change === 'rising' ? 'more often' : 'less often'
  return `${shareText} reviews ${what}, ${often} than in the 12 months before.`
}

/** Said where an issue has too few reviews for the engine to call a direction. */
export const TOO_FEW_FOR_A_TREND = 'Too few reviews for a trend'

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

/**
 * Splits a template line at its first colon: the clause before it is the lead the page
 * sets in bold ("Facilities and equipment is the top problem"). A line with no colon in
 * a sensible place has no lead.
 */
export function splitLead(text: string): Readonly<{ lead: string | null; rest: string }> {
  const index = text.indexOf(': ')
  if (index < 3 || index > 72) return { lead: null, rest: text }
  return { lead: text.slice(0, index), rest: text.slice(index + 1) }
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
