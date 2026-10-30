// Counting, for the Guest voice 2.0 page: how many reviews name an issue as a problem or
// as praise, and how many name a topic. Reviews are counted, not mentions: a review that
// names the same issue twice is one review, because a review is what a manager opens.
// Pure functions of the reviews they are given.
import type { ReviewPolarityV3 } from '#/shared/review-analysis-v3'
import type { ReviewTopicV3 } from '#/shared/review-topic-taxonomy'
import { guestVoiceTopicStatus } from '../../domain/guest-voice-topic-status'
import type { GuestVoiceTopicAssessment } from './guest-voice-v2-check-in'
import { ratingCountsOf, type RatingCounts } from '../aspect-review-evidence'
import { senseOf, type GuestVoiceReview, type Sense } from './guest-voice-v2-facts'

export function issueSenseKey(groupId: string, sense: Sense): string {
  return `${groupId}:${sense}`
}

/** The reviews that name one issue in one sense, each once, and the stars they gave. */
export type IssueTally = Readonly<{
  groupId: string
  sense: Sense
  reviews: readonly GuestVoiceReview[]
  stars: RatingCounts
}>

type IssueSense = Readonly<{ groupId: string; sense: Sense }>

/** The issue and sense pairs a review counts under, each once. */
function issueSensesOf(review: GuestVoiceReview): readonly IssueSense[] {
  const found = new Map<string, IssueSense>()
  for (const mention of review.mentions) {
    const sense = senseOf(mention.polarity)
    if (sense === null || mention.issueGroupId === null) continue
    found.set(issueSenseKey(mention.issueGroupId, sense), {
      groupId: mention.issueGroupId,
      sense,
    })
  }
  return [...found.values()]
}

export function tallyIssues(
  reviews: readonly GuestVoiceReview[],
): ReadonlyMap<string, IssueTally> {
  const collected = new Map<string, IssueSense & { reviews: GuestVoiceReview[] }>()
  for (const review of reviews) {
    for (const issueSense of issueSensesOf(review)) {
      const key = issueSenseKey(issueSense.groupId, issueSense.sense)
      const entry = collected.get(key) ?? { ...issueSense, reviews: [] }
      entry.reviews.push(review)
      collected.set(key, entry)
    }
  }
  return new Map(
    [...collected].map(([key, entry]) => [
      key,
      Object.freeze({
        groupId: entry.groupId,
        sense: entry.sense,
        reviews: Object.freeze(entry.reviews),
        stars: ratingCountsOf(entry.reviews),
      }),
    ]),
  )
}

/** How many reviews name each issue in each sense, for the Property's previous 12 months. */
export function countIssueReviews(
  reviews: readonly GuestVoiceReview[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const review of reviews) {
    for (const { groupId, sense } of issueSensesOf(review)) {
      const key = issueSenseKey(groupId, sense)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

/** The reviews that name one topic, how they feel about it, and the stars they gave. */
export type TopicTally = Readonly<{
  topic: ReviewTopicV3
  assessment: GuestVoiceTopicAssessment
  praise: number
  complaint: number
  neutral: number
  reviews: readonly GuestVoiceReview[]
  stars: RatingCounts
}>

/** The topics a review names, with the polarities it names each in. */
function topicPolaritiesOf(
  review: GuestVoiceReview,
): ReadonlyMap<ReviewTopicV3, ReadonlySet<ReviewPolarityV3>> {
  const topics = new Map<ReviewTopicV3, Set<ReviewPolarityV3>>()
  for (const mention of review.mentions) {
    const polarities = topics.get(mention.topic) ?? new Set<ReviewPolarityV3>()
    polarities.add(mention.polarity)
    topics.set(mention.topic, polarities)
  }
  return topics
}

export function tallyTopics(
  reviews: readonly GuestVoiceReview[],
): ReadonlyMap<ReviewTopicV3, TopicTally> {
  const collected = new Map<
    ReviewTopicV3,
    {
      praise: number
      complaint: number
      neutral: number
      happy: number
      mixed: number
      unhappy: number
      neutralOnly: number
      reviews: GuestVoiceReview[]
    }
  >()
  for (const review of reviews) {
    for (const [topic, polarities] of topicPolaritiesOf(review)) {
      const entry = collected.get(topic) ?? {
        happy: 0,
        mixed: 0,
        unhappy: 0,
        neutralOnly: 0,
        praise: 0,
        complaint: 0,
        neutral: 0,
        reviews: [],
      }
      const positive = polarities.has('positive')
      const negative = polarities.has('negative')
      if (positive && negative) entry.mixed += 1
      else if (positive) entry.happy += 1
      else if (negative) entry.unhappy += 1
      else entry.neutralOnly += 1
      if (polarities.has('positive')) entry.praise += 1
      if (polarities.has('negative')) entry.complaint += 1
      if (polarities.has('neutral')) entry.neutral += 1
      entry.reviews.push(review)
      collected.set(topic, entry)
    }
  }
  return new Map(
    [...collected].map(([topic, entry]) => [
      topic,
      Object.freeze({
        topic,
        assessment: {
          ...guestVoiceTopicStatus({
            mentionedReviews: entry.reviews.length,
            happyReviews: entry.happy,
          }),
          mentionedReviewCount: entry.reviews.length,
          happyReviewCount: entry.happy,
          mixedReviewCount: entry.mixed,
          unhappyReviewCount: entry.unhappy,
          neutralOnlyReviewCount: entry.neutralOnly,
        },
        praise: entry.praise,
        complaint: entry.complaint,
        neutral: entry.neutral,
        reviews: Object.freeze(entry.reviews),
        stars: ratingCountsOf(entry.reviews),
      }),
    ]),
  )
}

/** How many reviews name each topic, in any way, for the Property's previous 12 months. */
export function countTopicReviews(
  reviews: readonly GuestVoiceReview[],
): ReadonlyMap<ReviewTopicV3, number> {
  const counts = new Map<ReviewTopicV3, number>()
  for (const review of reviews) {
    for (const topic of topicPolaritiesOf(review).keys()) {
      counts.set(topic, (counts.get(topic) ?? 0) + 1)
    }
  }
  return counts
}
