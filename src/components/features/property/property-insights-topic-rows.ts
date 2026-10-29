// What the Guest voice topics table says about each topic, as plain data.
//
// The table used to rank topics by "impact", a signed score nobody could check
// against a review. A row now says what a manager can: in how many of the reviews
// the topic is named ("19 of 96"), how many of those praise it and how many
// complain, what stars the complaining reviews gave next to everyone else's, and,
// only when the evidence is there, that the share moved. The rows are ordered by
// the stars at stake in the complaints.
import type {
  AiPropertyInsightAspect,
  AiPropertyInsightsAllTimeReady,
  AiPropertyInsightsPresetReady,
} from '#/contexts/ai/application/public-api'
import { formatNumber } from '#/lib/format'
import { ASPECT_LABELS } from '#/shared/aspect-labels'
import type { AspectTaxonomyV1Id } from '#/shared/aspect-taxonomy'

export type PropertyInsightsEvidence =
  AiPropertyInsightsAllTimeReady | AiPropertyInsightsPresetReady

/**
 * Under this many reviews a topic shows its counts and nothing else: an average
 * of two reviews is an anecdote, and the stars column says so ("too few"). The
 * praise and complaints bar, a proportion of the same reviews, is not drawn either.
 */
export const TOPIC_MIN_REVIEWS = 3

export type TopicRow = Readonly<{
  aspect: AspectTaxonomyV1Id
  label: string
  /** Reviews that name the topic in any way, each once. */
  reviews: number
  praise: AiPropertyInsightAspect | undefined
  complaints: AiPropertyInsightAspect | undefined
}>

export function praiseReviews(row: TopicRow): number {
  return row.praise?.reviewCount ?? 0
}

export function complaintReviews(row: TopicRow): number {
  return row.complaints?.reviewCount ?? 0
}

/** The most a topic's complaints could add to the window's average, if known. */
function complaintUpTo(row: TopicRow): number | null {
  return row.complaints?.stars.upTo ?? null
}

/**
 * Most stars at stake in the complaints first, then the most complaining
 * reviews, then the most praise. A topic whose complaints are too few to weigh
 * (`upTo` unknown) comes after one that was weighed and found worth nothing.
 */
function byStarsAtStake(left: TopicRow, right: TopicRow): number {
  return (
    (complaintUpTo(right) ?? -1) - (complaintUpTo(left) ?? -1) ||
    complaintReviews(right) - complaintReviews(left) ||
    praiseReviews(right) - praiseReviews(left) ||
    left.label.localeCompare(right.label)
  )
}

export function topicRows(evidence: PropertyInsightsEvidence): readonly TopicRow[] {
  const topics = new Map<
    AspectTaxonomyV1Id,
    {
      praise?: AiPropertyInsightAspect
      complaints?: AiPropertyInsightAspect
      reviews: number
    }
  >()
  for (const entry of evidence.aspects) {
    const topic = topics.get(entry.aspect) ?? { reviews: entry.topicReviewCount }
    if (entry.polarity === 'positive') topic.praise = entry
    if (entry.polarity === 'negative') topic.complaints = entry
    topics.set(entry.aspect, topic)
  }
  return (
    [...topics]
      // The read keeps a topic that only the 12 months before named, so its row could
      // say it fell; nothing named it in this window, and a row of 0 says nothing.
      .filter(([, topic]) => topic.reviews > 0)
      .map(([aspect, topic]): TopicRow => ({
        aspect,
        label: ASPECT_LABELS[aspect],
        reviews: topic.reviews,
        praise: topic.praise,
        complaints: topic.complaints,
      }))
      .sort(byStarsAtStake)
  )
}

/** "19 of 96": reviews that name the topic, of the reviews read for topics. */
export function reviewsText(row: TopicRow, readForTopics: number): string {
  return `${formatNumber(row.reviews)} of ${formatNumber(readForTopics)}`
}

/** A star average to one decimal: "2.1". */
function oneDecimal(value: number): string {
  return formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

export type ComplaintStars =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'too_few' }>
  | Readonly<{ kind: 'stars'; complaining: string; rest: string }>

/**
 * The stars the reviews that complain about the topic gave, next to the rest of
 * the window's: "2.1★, the rest 4.3★". Under three reviews it says so rather than
 * print an average; a topic nobody complains about has nothing to compare.
 */
export function complaintStars(row: TopicRow): ComplaintStars {
  const complaints = row.complaints
  if (complaints === undefined || complaints.reviewCount === 0) return { kind: 'none' }
  const { mentionedAverage, othersAverage } = complaints.stars
  if (
    row.reviews < TOPIC_MIN_REVIEWS ||
    complaints.reviewCount < TOPIC_MIN_REVIEWS ||
    mentionedAverage === null ||
    othersAverage === null
  ) {
    return { kind: 'too_few' }
  }
  return {
    kind: 'stars',
    complaining: oneDecimal(mentionedAverage),
    rest: oneDecimal(othersAverage),
  }
}

export type TopicChange = Readonly<{
  /** "Complaints likely rising". */
  text: string
  /** Whether the movement is good news for the property: it sets the tone, never the meaning. */
  tone: 'positive' | 'negative'
  direction: 'up' | 'down'
}>

const CHANGE_WORDS = {
  negative: { rising: 'Complaints likely rising', falling: 'Complaints likely falling' },
  positive: { rising: 'Praise likely rising', falling: 'Praise likely falling' },
} as const

/**
 * What moved against the previous 12 months, in words, only for a share that did so
 * with enough evidence. A steady or unknown change says nothing, and neither does
 * a topic under three reviews.
 */
export function topicChanges(row: TopicRow): readonly TopicChange[] {
  if (row.reviews < TOPIC_MIN_REVIEWS) return []
  const changes: TopicChange[] = []
  for (const polarity of ['negative', 'positive'] as const) {
    const entry = polarity === 'negative' ? row.complaints : row.praise
    if (entry?.change !== 'rising' && entry?.change !== 'falling') continue
    const rising = entry.change === 'rising'
    changes.push({
      text: CHANGE_WORDS[polarity][entry.change],
      // More complaints and less praise are the bad news.
      tone: rising === (polarity === 'positive') ? 'positive' : 'negative',
      direction: rising ? 'up' : 'down',
    })
  }
  return changes
}
