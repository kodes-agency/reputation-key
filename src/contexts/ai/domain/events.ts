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

export type AiEvent =
  | AiPropertyTrendGenerationRequested
  | AiReviewAnalysisBackfillRequested
  | AiReviewUrgentDetected
