// What the Guest voice 2.0 read is worked out from: the reviews that have a current v3
// analysis, and what each says, after a manager's corrections. Content-free: a review
// here is an id, a day, its stars and its mentions, never a word a guest wrote.
//
// The store (`AiGuestVoiceFactsPort`) fills these in; the functions beside this file
// turn them into the page. Keeping the two apart means the page's rules (what is a
// problem, what is worth fixing first) are plain functions of this data and can be
// tested without a database.
import type {
  ReviewNamesPersonV3,
  ReviewPolarityV3,
  ReviewStrengthV3,
  ReviewUrgentReasonV3,
} from '#/shared/review-analysis-v3'
import type { ReviewTopicV3 } from '#/shared/review-topic-taxonomy'

export type StarValue = 1 | 2 | 3 | 4 | 5

/**
 * One mention of a review as the page counts it: the analysis's own, with a manager's
 * correction applied. A mention a manager removed is not here; one marked "not a
 * problem" is here as neutral; one whose cause was changed is here under the new cause.
 */
export type GuestVoiceMention = Readonly<{
  mentionOrdinal: number
  topic: ReviewTopicV3
  polarity: ReviewPolarityV3
  strength: ReviewStrengthV3
  /** What was wrong or right ("not working"): the second half of the cause. */
  thing: string | null
  cause: string | null
  /** The Property's issue this mention belongs to; null only for a row written before grouping. */
  issueGroupId: string | null
  namesPerson: ReviewNamesPersonV3 | null
}>

/** A review with a current, ready v3 analysis. */
export type GuestVoiceReview = Readonly<{
  reviewId: string
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  /** The Property's own calendar day the review was left. */
  localDate: string
  rating: StarValue
  urgentReason: ReviewUrgentReasonV3 | null
  /**
   * The analysis flagged a mention of this review as naming a person (a guest or a team
   * member). It is read from the answer as the provider gave it, so a manager setting a
   * mention aside does not clear it: that takes the topic out of the counts, not the
   * name out of the review's text. A review with this flag is never quoted.
   */
  namesAPerson: boolean
  mentions: readonly GuestVoiceMention[]
}>

/** An issue: one thing at one Property under one topic, as a manager may have named it. */
export type GuestVoiceIssueGroup = Readonly<{
  id: string
  topic: ReviewTopicV3
  /** The normalized thing ("air conditioning"); null for the topic-level issue. */
  canonicalThing: string | null
  displayName: string | null
  hidden: boolean
}>

/** The reviews of one read, with the issues they point to. */
export type GuestVoiceFacts = Readonly<{
  reviews: readonly GuestVoiceReview[]
  groups: ReadonlyMap<string, GuestVoiceIssueGroup>
}>

/** The two senses a mention can count in: a problem named, or something praised. */
export type Sense = 'complaint' | 'praise'

/** Which way a mention points; a neutral one is neither. */
export function senseOf(polarity: ReviewPolarityV3): Sense | null {
  if (polarity === 'negative') return 'complaint'
  if (polarity === 'positive') return 'praise'
  return null
}
