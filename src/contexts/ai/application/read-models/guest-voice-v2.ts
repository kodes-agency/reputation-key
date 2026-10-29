// The Guest voice 2.0 read model: what the page and the issue drawer are drawn from
// (v3 contract, section 9). Content-free except the quotes: a quote is `LiveEvidence`,
// read from the live review text for one response, and never stored.
//
// The names and shapes are the contract's. A field the agreed design needs and the
// contract does not have is marked `ADDED` with the question it raises for the
// read-model slice (4.1); each is optional or a new variant, so the slice can adopt it
// as it stands or drop it, and the page degrades by leaving that part out.
import type { ReviewTopicV3, UrgentReasonV3 } from './guest-voice-v2-v3-vocabulary'

/** The windows the statistics engine chooses between. */
export type Window = '30d' | '90d' | '180d' | '365d'
export type Change = 'rising' | 'falling' | 'steady' | 'unknown'
export type EvidenceLevel = 'not_enough' | 'early' | 'likely'

/** What is known of one issue (or one topic) over the window, worked out by the engine. */
export type IssueStatistics = Readonly<{
  /** Reviews with text that name it. */
  reviewCount: number
  /** Reviews with text in the window: the "of 128" in "19 of 128". */
  textReviewCount: number
  /** Every review in the window, those with only stars included. */
  allReviewCount: number
  /** "19 of 128" (`shareText`). */
  shareText: string
  /** Null under 20 reviews with text: counts first, percentages only above that. */
  sharePercent: number | null
  /** Average stars of the reviews that name it, and of every other review. */
  mentionedAverage: number | null
  othersAverage: number | null
  gap: number | null
  /** "Worth up to": share of every review x the gap, to the nearest 0.05 stars. */
  upTo: number | null
  change: Change
  evidenceLevel: EvidenceLevel
}>

/**
 * One quote, read live: the text and where, in it, the cited sentences are. A review whose
 * cited sentences name a person is never one (decision Q5): the read leaves it out, so
 * nothing here can be asked to hide a name.
 */
export type LiveEvidence = Readonly<{
  inboxItemId: string
  /** A day (`2026-10-18`) or an instant; the page prints the day. */
  reviewedAt: string
  rating: 1 | 2 | 3 | 4 | 5
  text: string
  /** Character offsets into `text`, one range per cited sentence. */
  sentenceRanges: readonly Readonly<{ start: number; end: number }>[]
}> // response-only; never persisted in AI storage

export type InShortLine = Readonly<{
  kind: 'fix_first' | 'protect' | 'change'
  text: string
  issueId: string | null
  topic: ReviewTopicV3
}>

export type FixFirstItem = Readonly<{
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
  issueId: string
  title: string
  topic: ReviewTopicV3
  reviewCount: 1 | 2
}>

export type ChangedItem = Readonly<{
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
  topic: ReviewTopicV3
  praiseReviews: number
  complaintReviews: number
  neutralReviews: number
  statistics: IssueStatistics
}>

export type GuestVoiceV2Ready = Readonly<{
  status: 'ready'
  readModelVersion: 'guest-voice-read-v2'
  statisticsVersion: 'guest-voice-statistics-v1'
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
  basis: Readonly<{ textReviewCount: number; starOnlyCount: number }>
  inShort: readonly InShortLine[]
  urgent: readonly FixFirstItem[]
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
type LatestReview = Readonly<{
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
  readModelVersion: 'guest-voice-read-v2'
  /** Reviews with text in the last 12 months. */
  textReviewCount: number
  latestReviews: readonly LatestReview[]
}>

export type GuestVoiceV2Read = GuestVoiceV2Ready | GuestVoiceV2NotEnough

export type IssueDrawer = Readonly<{
  issueId: string
  title: string
  topic: ReviewTopicV3
  definition: string
  hidden: boolean
  statistics: IssueStatistics
  /** The last 12 months, oldest first; `month` is `2026-10`. */
  twelveMonthSeries: readonly Readonly<{
    month: string
    complaintReviews: number
    textReviews: number
  }>[]
  causes: readonly Readonly<{ cause: string; reviewCount: number }>[]
  liveEvidence: readonly LiveEvidence[]
}>
