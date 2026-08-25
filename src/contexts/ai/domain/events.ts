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
 * One review re-admitted to review analysis by the audited operator backfill
 * (`ops:ai-reanalyze`), carrying the FRESH analysis sequence allocated for it.
 *
 * Deliberately its OWN event type rather than a re-emitted `review.created` /
 * `review.updated`: those two are also consumed by the inbox
 * (`inbox.on-review-created` / `inbox.on-review-updated`), so re-emitting one
 * to reach the AI consumer would churn inbox items for reviews that did not
 * change. Nothing about the review changed — only the analysis plane is being
 * replayed — so only `ai.analyze-review-event` registers for this type.
 *
 * Identifier-only (ADR 0030). `analysisSequence` is the sequence freshly
 * allocated from `lock_review_ai_analysis_head_v1`, never the review's previous
 * one: the analysis log is strictly contiguous and reusing a historical
 * sequence would stall the cursor permanently.
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

export type AiEvent =
  AiPropertyTrendGenerationRequested | AiReviewAnalysisBackfillRequested
