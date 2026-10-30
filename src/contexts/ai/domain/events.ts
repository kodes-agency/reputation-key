import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import { assert } from '#/shared/domain/assert'
import { newEventId } from '#/shared/domain/event-id'

export type AiPropertyTrendGenerationRequested = Readonly<{
  _tag: 'ai.property_trend.generation_requested'
  eventId: string
  scheduleId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  occurredAt: Date
  correlationId: string | null
}>

export const aiPropertyTrendGenerationRequested = (
  args: Omit<AiPropertyTrendGenerationRequested, '_tag' | 'eventId' | 'correlationId'> & {
    correlationId?: string | null
  },
): AiPropertyTrendGenerationRequested => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  assert(args.scheduleId !== '', 'scheduleId required')
  return {
    ...args,
    _tag: 'ai.property_trend.generation_requested',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
  }
}

/**
 * One review re-admitted to review analysis by the first-enablement Review
 * Analysis enrollment replay, carrying the FRESH analysis sequence allocated for it.
 *
 * Deliberately its OWN event type rather than a re-emitted `review.created` /
 * `review.updated`: those two are also consumed by the inbox
 * (`inbox.on-review-created` / `inbox.on-review-updated`), so re-emitting one
 * to reach the AI consumer would churn inbox items for reviews that did not
 * change. Nothing about the review changed — only the analysis plane is being
 * replayed — so only `ai.analyze-review-event` registers for this type.
 *
 * Identifier-only (ADR 0030). `analysisSequence` is freshly allocated from
 * `lock_review_ai_analysis_head_v1`, never reused: generations compare Review
 * revisions monotonically, so a later settlement always supersedes an earlier
 * settlement for that Review even when different Reviews complete out of order.
 */
export type AiReviewAnalysisBackfillRequested = Readonly<{
  _tag: 'ai.review_analysis.backfill_requested'
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  occurredAt: Date
  correlationId: string | null
}>

export const aiReviewAnalysisBackfillRequested = (
  args: Omit<AiReviewAnalysisBackfillRequested, '_tag' | 'eventId' | 'correlationId'> & {
    correlationId?: string | null
  },
): AiReviewAnalysisBackfillRequested => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  assert(
    Number.isSafeInteger(args.sourceEpoch) && args.sourceEpoch >= 0,
    'sourceEpoch must be a nonnegative safe integer',
  )
  assert(
    Number.isSafeInteger(args.sourceRevision) && args.sourceRevision > 0,
    'sourceRevision must be a positive safe integer',
  )
  assert(
    Number.isSafeInteger(args.analysisSequence) && args.analysisSequence > 0,
    'analysisSequence must be a positive safe integer',
  )
  return {
    ...args,
    _tag: 'ai.review_analysis.backfill_requested',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
  }
}

/**
 * A review analysis v3 found a review Urgent (a reported risk to safety or health,
 * discrimination or a legal threat). It is the one finding of a provider's answer that
 * starts a notification (ADR 0031, amended 2026-10-30; ADR 0046, amended 2026-10-30).
 *
 * Identifier-only (ADR 0030), and deliberately less than the analysis: it names the
 * review revision and the analysis that found it, and says nothing of why. The reason is
 * stored beside the analysis and read in the app. A field called `reason` would be
 * stripped from an outbox payload as content in any case.
 *
 * One fact per review REVISION: a re-analysis of the same revision (another epoch, a
 * reopen) is the same alert, so its `eventId` is derived from the revision by the writer
 * and an existing fact is not written again. A new revision of the review is a new alert.
 */
export type AiReviewUrgentDetected = Readonly<{
  _tag: 'ai.review_analysis.urgent_detected'
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  occurredAt: Date
  correlationId: string | null
}>

export const aiReviewUrgentDetected = (
  args: Omit<AiReviewUrgentDetected, '_tag' | 'eventId' | 'correlationId'> & {
    /** The writer's deterministic id for this review revision; random when absent. */
    eventId?: string
    correlationId?: string | null
  },
): AiReviewUrgentDetected => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  assert(
    Number.isSafeInteger(args.sourceEpoch) && args.sourceEpoch >= 0,
    'sourceEpoch must be a nonnegative safe integer',
  )
  assert(
    Number.isSafeInteger(args.sourceRevision) && args.sourceRevision > 0,
    'sourceRevision must be a positive safe integer',
  )
  assert(
    Number.isSafeInteger(args.analysisSequence) && args.analysisSequence > 0,
    'analysisSequence must be a positive safe integer',
  )
  return {
    ...args,
    _tag: 'ai.review_analysis.urgent_detected',
    eventId: args.eventId ?? newEventId(),
    correlationId: args.correlationId ?? null,
  }
}

/** One line of the Guest voice summary: the same three the page's "In short" has. */
export type GuestVoiceSummaryFactLine = Readonly<{
  kind: 'fix_first' | 'protect' | 'change'
  /**
   * One of the twelve fixed topics (`ReviewTopicV3`). The domain imports no taxonomy, so it
   * is a string here; the outbox schema admits only the twelve, and the Guest voice read
   * that fills it types it as the topic.
   */
  topic: string
  /** The issue the line is about, for a link to its page; null for none. */
  issueId: string | null
  /** Reviews that name it, and reviews with text in the window ("19 of 128"). */
  reviewCount: number
  textReviewCount: number
  /** Stars it may be worth on the window's average, to the nearest 0.05; null where unknown. */
  upTo: number | null
  /** Which way it moved, on a `change` line only. */
  change: 'rising' | 'falling' | null
  /** Whether the reviews that moved praise it or complain of it, on a `change` line only. */
  polarity: 'complaint' | 'praise' | null
}>

/**
 * A Property's Guest voice summary is due to be mailed (decision 11 of the v3 contract): the
 * Monday-morning email, or the roundup of the first Monday of the month. The AI context
 * decides it, from the same read the Guest voice page is drawn from, and writes this fact;
 * Feed finds the managers who asked for it and mails it.
 *
 * Content-free (ADR 0046 r.8; ADR 0031): the topics are the twelve fixed ones, and the
 * rest is counts, a window and the links a line opens. No cause, quote, sentence, person,
 * review or Inbox item is in it, and nor is the issue's name: that is the guests' words
 * boiled down, and read in the app. One fact per Property per Monday: its id is derived
 * from the Property and the day, so the hourly sweep that finds the Property due on
 * several runs writes it once.
 */
export type AiGuestVoiceSummaryReady = Readonly<{
  _tag: 'ai.guest_voice_summary.ready'
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  summaryKind: 'weekly' | 'monthly'
  /** The Property-local Monday the summary is for. */
  localDate: string
  window: '30d' | '90d' | '180d' | '365d'
  startLocalDate: string
  endLocalDate: string
  lines: readonly GuestVoiceSummaryFactLine[]
  occurredAt: Date
  correlationId: string | null
}>

const MAX_SUMMARY_LINES = 3

export const aiGuestVoiceSummaryReady = (
  args: Omit<AiGuestVoiceSummaryReady, '_tag' | 'eventId' | 'correlationId'> & {
    /** The writer's deterministic id for this Property and Monday; random when absent. */
    eventId?: string
    correlationId?: string | null
  },
): AiGuestVoiceSummaryReady => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  assert(
    /^\d{4}-\d{2}-\d{2}$/.test(args.localDate),
    'localDate must be a Property-local day (YYYY-MM-DD)',
  )
  assert(args.lines.length <= MAX_SUMMARY_LINES, 'a summary has at most three lines')
  return {
    ...args,
    _tag: 'ai.guest_voice_summary.ready',
    eventId: args.eventId ?? newEventId(),
    correlationId: args.correlationId ?? null,
  }
}

export type AiEvent =
  | AiPropertyTrendGenerationRequested
  | AiReviewAnalysisBackfillRequested
  | AiReviewUrgentDetected
  | AiGuestVoiceSummaryReady
