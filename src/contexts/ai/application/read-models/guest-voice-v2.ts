// The Guest voice 2.0 read model: what the page and the issue drawer are drawn from
// (v3 contract, section 9). Content-free except the quotes: a quote is `LiveEvidence`,
// read from the live review text for one response, and never stored.
// Check-in additions are required and transient; legacy page/Monday fields remain.
import type { ReviewUrgentReasonV3 as UrgentReasonV3 } from '#/shared/review-analysis-v3'
import type { ReviewTopicV3 } from '#/shared/review-topic-taxonomy'
import type { GUEST_VOICE_STATISTICS_VERSION } from '../../domain/guest-voice-statistics'

import type {
  GuestVoiceBasis,
  GuestVoiceWindowContext,
  GuestVoiceSeriousConcerns,
  GuestVoiceRatingTrend,
  GuestVoiceTopicAssessment,
} from './guest-voice-v2-check-in'

import type {
  Window,
  Change,
  IssueStatistics,
  LiveEvidence,
} from './guest-voice-v2-common'
export type {
  Window,
  Change,
  EvidenceLevel,
  IssueStatistics,
  LiveEvidence,
} from './guest-voice-v2-common'
export type { IssueDrawer } from './guest-voice-v2-check-in'

export type InShortLine = Readonly<{
  kind: 'fix_first' | 'protect' | 'change'
  text: string
  issueId: string | null
  topic: ReviewTopicV3
}>

export type FixFirstItem = Readonly<{
  answerName: string
  lastMentionedLocalDate: string
  issueId: string
  title: string
  topic: ReviewTopicV3
  causes: readonly string[]
  urgentReason: UrgentReasonV3 | null
  statistics: IssueStatistics
  /**
   * ADDED. One live quote, the evidence underlined, for the card. The contract keeps
   * the page content-free and reads quotes only for the drawer; the agreed design puts
   * one on each card ("in guests' own words"). Null or absent: the card has none, as
   * for a review that names a person or whose text has gone.
   */
  quote?: LiveEvidence | null
}>

export type GuestsLoveItem = Readonly<{
  answerName: string
  lastMentionedLocalDate: string
  issueId: string
  title: string
  topic: ReviewTopicV3
  statistics: IssueStatistics
  /** ADDED, as `FixFirstItem.quote`. */
  quote?: LiveEvidence | null
}>

export type StaffPraiseLine = Readonly<{
  reviewCount: number
  inboxHref: string
}> | null

export type WatchItem = Readonly<{
  answerName: string
  lastMentionedLocalDate: string
  issueId: string
  title: string
  topic: ReviewTopicV3
  reviewCount: 1 | 2
}>

export type ChangedItem = Readonly<{
  answerName: string
  lastMentionedLocalDate: string
  issueId: string
  title: string
  topic: ReviewTopicV3
  change: Exclude<Change, 'steady' | 'unknown'>
  evidenceLevel: 'likely'
  statistics: IssueStatistics
  /**
   * ADDED. Whether the reviews that moved praise it or complain about it: a rise is
   * good news for praise and bad news for a complaint, and the page says which.
   */
  polarity: 'complaint' | 'praise'
}>

export type TopicRow = Readonly<{
  assessment: GuestVoiceTopicAssessment
  topic: ReviewTopicV3
  praiseReviews: number
  complaintReviews: number
  neutralReviews: number
  statistics: IssueStatistics
}>

export type GuestVoiceV2Ready = Readonly<{
  status: 'ready'
  readModelVersion: 'guest-voice-read-v2'
  checkInVersion: 'guest-voice-check-in-v1'
  /** The engine that worked the figures out (`GUEST_VOICE_STATISTICS_VERSION`). */
  statisticsVersion: typeof GUEST_VOICE_STATISTICS_VERSION
  window: Window
  startLocalDate: string
  endLocalDate: string
  dataThroughLocalDate: string
  provisional: boolean
  /**
   * ADDED. What the window holds, so the page can name it: "Last 90 days, chosen because
   * it holds 128 reviews with text". The statistics carry these per issue, and a page with
   * no issue at all still has to say them.
   */
  basis: GuestVoiceBasis
  ratingTrend: GuestVoiceRatingTrend
  seriousConcerns: GuestVoiceSeriousConcerns
  sectionTotals: Readonly<{ fixFirst: number; guestsLove: number; watch: number }>
  remainingCounts: Readonly<{ fixFirst: number; guestsLove: number; watch: number }>
  inShort: readonly InShortLine[]
  urgent: readonly FixFirstItem[]
  /**
   * ADDED. Urgent reviews in the window that no card above stands for: the analysis
   * found the risk but no problem to put under an issue, or there are more than the page
   * has room for. They are on the page as a count and in the Inbox, never dropped;
   * absent when there are none.
   */
  urgentOtherCount?: number
  fixFirst: readonly FixFirstItem[]
  guestsLove: readonly GuestsLoveItem[]
  staffPraise: StaffPraiseLine
  watch: readonly WatchItem[]
  whatChanged: readonly ChangedItem[]
  everyTopic: readonly TopicRow[]
}>

/**
 * ADDED. A recent review, for a property too young to show patterns. `text` is null when
 * the review names a person or has changed or gone: the row then has its stars, its day
 * and the way to the Inbox.
 */
export type LatestReview = Readonly<{
  inboxItemId: string
  reviewedAt: string
  rating: 1 | 2 | 3 | 4 | 5
  text: string | null
}>

/**
 * ADDED. Under about 10 reviews with text in 12 months there are no patterns to spot:
 * the page says so and shows the latest reviews (decision Q7).
 */
export type GuestVoiceV2NotEnough = Readonly<{
  status: 'not_enough_reviews'
  context: GuestVoiceWindowContext
  seriousConcerns: GuestVoiceSeriousConcerns
  allReviewCount: number
  /** Number of previews actually accessible after live resolution, at most three. */
  latestReviewCount: number
  readModelVersion: 'guest-voice-read-v2'
  checkInVersion: 'guest-voice-check-in-v1'
  /** Reviews with text in the last 12 months. */
  textReviewCount: number
  latestReviews: readonly LatestReview[]
}>

export type GuestVoiceV2Read = GuestVoiceV2Ready | GuestVoiceV2NotEnough
