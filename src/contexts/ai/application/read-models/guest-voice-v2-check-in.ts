import type { ReviewUrgentReasonV3 } from '#/shared/review-analysis-v3'
import type { ReviewTopicV3 } from '#/shared/review-topic-taxonomy'
import type { GuestVoiceTopicStatus } from '../../domain/guest-voice-topic-status'
import type { IssueDrawer, LiveEvidence, Window } from './guest-voice-v2'
export type { GuestVoiceTopicStatus } from '../../domain/guest-voice-topic-status'

export type GuestVoiceBasis = Readonly<{
  textReviewCount: number
  starOnlyCount: number
  analysedTextReviewCount: number
}>
export type GuestVoiceWindowContext = Readonly<{
  window: Window
  startLocalDate: string
  endLocalDate: string
  dataThroughLocalDate: string
  provisional: boolean
  basis: GuestVoiceBasis
}>
export type UrgentConcernItem = Readonly<{
  key: string
  issueId: string | null
  topic: ReviewTopicV3 | null
  title: string
  urgentReason: ReviewUrgentReasonV3
  reviewCount: number
  lastReportedLocalDate: string
}>
export type GuestVoiceSeriousConcerns = Readonly<{
  items: readonly UrgentConcernItem[]
  groupCount: number
  reviewCount: number
  remainingGroupCount: number
  remainingReviewCount: number
  coverage: 'complete' | 'provisional'
}>
export type RatingTrendPeriod = Readonly<{
  startLocalDate: string
  endLocalDate: string
  reviewCount: number
  averageStars: number | null
  happyReviewCount: number
}>
export type GuestVoiceRatingMonth = RatingTrendPeriod &
  Readonly<{
    month: string
    partialStart: boolean
    partialEnd: boolean
  }>
export type GuestVoiceRatingTrend = Readonly<{
  methodVersion: 'guest-voice-rating-trend-v1'
  population: 'current_reviews_with_text'
  months: readonly GuestVoiceRatingMonth[]
  before: RatingTrendPeriod
  recent: RatingTrendPeriod
  verdict: 'improving' | 'steady' | 'slipping' | 'not_enough'
  reason: 'assessed' | 'too_few_reviews' | 'analysis_incomplete'
}>
export type GuestVoiceTopicAssessment = Readonly<{
  status: GuestVoiceTopicStatus
  mentionedReviewCount: number
  happyReviewCount: number
  mixedReviewCount: number
  unhappyReviewCount: number
  neutralOnlyReviewCount: number
  happyShare: number | null
}>
export type GuestVoiceDetailTarget =
  | Readonly<{ kind: 'issue'; issueId: string; sense: 'complaint' | 'praise' }>
  | Readonly<{ kind: 'concern'; issueId: string | null; reason: ReviewUrgentReasonV3 }>
  | Readonly<{ kind: 'topic'; topic: ReviewTopicV3 }>

/** Scope for the existing issue/polarity/day or urgent Inbox search. No review-id filter. */
export type GuestVoiceMatchingReviewScope = Readonly<{
  startLocalDate: string
  endLocalDate: string
  issueId: string | null
  sense: 'complaint' | 'praise' | null
}>
export type GuestVoiceHistoryMonth = Readonly<{
  month: string
  reviewCount: number
  textReviews: number
  startLocalDate: string
  endLocalDate: string
  partialStart: boolean
  partialEnd: boolean
}>
export type GuestVoiceCauseRow = Readonly<{
  issueId: string | null
  cause: string | null
  title: string
  reviewCount: number
}>
export type GuestVoiceConcernDrawer = Readonly<{
  kind: 'concern'
  target: Extract<GuestVoiceDetailTarget, { kind: 'concern' }>
  title: string
  reason: ReviewUrgentReasonV3
  reviewCount: number
  lastReportedLocalDate: string
  context: GuestVoiceWindowContext
  liveEvidence: readonly LiveEvidence[]
  monthlySeries: readonly GuestVoiceHistoryMonth[]
  matchingReviews: GuestVoiceMatchingReviewScope
}>
export type GuestVoiceTopicDrawer = Readonly<{
  kind: 'topic'
  topic: ReviewTopicV3
  assessment: GuestVoiceTopicAssessment
  context: GuestVoiceWindowContext
  likedCauses: readonly GuestVoiceCauseRow[]
  dislikedCauses: readonly GuestVoiceCauseRow[]
  linkedConcerns: readonly UrgentConcernItem[]
}>
export type GuestVoiceDetailRead =
  | Readonly<{
      status: 'ready'
      drawer: IssueDrawer | GuestVoiceConcernDrawer | GuestVoiceTopicDrawer
    }>
  | Readonly<{ status: 'not_found' | 'disabled' | 'preparing' | 'refresh_required' }>
