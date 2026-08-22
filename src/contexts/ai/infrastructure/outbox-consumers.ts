import { z } from 'zod/v4'
import {
  registerConsumer,
  type ConsumerEvent,
  type ConsumerResult,
} from '#/shared/outbox/dispatcher'
import type { OutboxRepository } from '#/shared/outbox'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type {
  AnalyzeReviewEventInput,
  AnalyzeReviewEventResult,
} from '../application/use-cases/analyze-review-event'

export const AI_REVIEW_ANALYSIS_CONSUMER = 'ai.analyze-review-event'
export const AI_PROPERTY_TREND_GENERATION_CONSUMER = 'ai.generate-property-trend'
/** The operator replay (`ops:ai-reanalyze`); the only chained event type. */
export const AI_REVIEW_ANALYSIS_BACKFILL_EVENT = 'ai.review_analysis.backfill_requested'

// Not `.strict()`: every emitted payload also carries envelope fields
// (`correlationId`, `occurredAt`, and `platform` for review events — see the
// canonical registry in shared/events/schema-registrations.ts). BQR-2.5
// allowlist-validates at insert, so only registered fields are ever persisted;
// a consumer re-asserting "no other keys" adds no safety and turns any envelope
// addition into a total outage. It did: every `review.created` for a freshly
// imported property failed with `unrecognized_keys`, so no review was ever
// analyzed. Unknown keys are dropped; the fields consumed stay fully validated.
const reviewEventPayloadSchema = z.object({
  organizationId: z.string().min(1),
  propertyId: z.uuid(),
  reviewId: z.uuid(),
  sourceEpoch: z.number().int().nonnegative(),
  sourceRevision: z.number().int().positive(),
  analysisSequence: z.number().int().positive(),
  change: z.enum(['source_expired', 'provider_deleted']).optional(),
})
const propertyTrendEventPayloadSchema = z.object({
  scheduleId: z.uuid(),
  organizationId: z.string().min(1),
  propertyId: z.uuid(),
})

export type RegisterAiConsumersInput = Readonly<{
  analyzeReviewEvent: (
    input: AnalyzeReviewEventInput,
  ) => Promise<AnalyzeReviewEventResult>
  receipts: OutboxRepository
  enqueuePropertyTrend: (scheduleId: string) => Promise<void>
  /**
   * Hand a backfill run its next review once this one has settled. A run may
   * only ever have ONE item in flight — `storeAnalysis` refuses unless the
   * allocation head still equals the sequence being stored — so the run cannot
   * emit ahead of its own cursor and something has to drive it from here. The
   * five-minute advance sweep is only the safety net for a lost hand-off.
   */
  advanceReviewAnalysisBackfill: (
    input: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
  ) => Promise<unknown>
}>

function dispositionFor(
  event: ConsumerEvent,
  change: 'source_expired' | 'provider_deleted' | undefined,
): AnalyzeReviewEventInput['disposition'] {
  if (event.eventType === 'review.source_transitioned') {
    return change ?? 'source_expired'
  }
  // A backfill is an explicit request to analyse retained content. It reuses
  // this path so the analysis logic is not duplicated, and it may only ever be
  // `pending`: a terminal disposition would consume the freshly allocated
  // sequence without producing the analysis the operator asked for.
  return 'pending'
}

/**
 * BQC-3.7 envelope timestamps as epoch milliseconds. `recordedAt` (outbox row
 * insert time) is stable across every redelivery of one event, so it anchors the
 * bounded AI operation horizon; `occurredAt` is the pre-3.7 fallback and null
 * means the use case anchors on the claimed operation instead.
 */
function envelopeRecordedAtEpochMillis(event: ConsumerEvent): number | null {
  for (const candidate of [event.recordedAt, event.occurredAt]) {
    if (candidate === undefined) continue
    const parsed = Date.parse(candidate)
    if (Number.isSafeInteger(parsed)) return parsed
  }
  return null
}

export async function handleAiReviewEvent(
  dependencies: RegisterAiConsumersInput,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const payload = reviewEventPayloadSchema.parse(event.payload)
  const result = await dependencies.analyzeReviewEvent({
    organizationId: organizationId(payload.organizationId),
    propertyId: propertyId(payload.propertyId),
    reviewId: reviewId(payload.reviewId),
    sourceEpoch: payload.sourceEpoch,
    sourceRevision: payload.sourceRevision,
    analysisSequence: payload.analysisSequence,
    eventEnvelopeId: event.eventId,
    disposition: dispositionFor(event, payload.change),
    eventRecordedAtEpochMillis: envelopeRecordedAtEpochMillis(event),
  })

  if (result.status === 'retry') {
    // Retry scheduling is BullMQ's (exponential 30s backoff, 8 attempts — see
    // DISPATCH_JOB_OPTIONS in src/shared/outbox/relay.ts). The domain bounds the
    // same work by its 15-minute operation horizon and terminal-settles there,
    // so this throw can never exhaust the dispatch budget while the outcome row
    // is still `pending`. The code is content-free.
    throw new Error(`AI review analysis retry required: ${result.code}`)
  }
  if (result.status === 'gap') {
    throw new Error('AI review analysis sequence gap')
  }

  const receiptStatus =
    result.status === 'generation_changed' ? ('obsolete' as const) : ('applied' as const)
  await dependencies.receipts.insertReceipt(
    event.eventId,
    AI_REVIEW_ANALYSIS_CONSUMER,
    receiptStatus,
  )

  // The receipt is written FIRST, so a failure below cannot re-run the analysis
  // — this review is done either way. The advance is idempotent (it re-reads
  // the run under the property lock and does nothing unless the in-flight item
  // has settled), so letting it throw is right: the job fails, BullMQ retries,
  // the receipt short-circuits the analysis, and only the hand-off is retried.
  if (event.eventType === AI_REVIEW_ANALYSIS_BACKFILL_EVENT) {
    await dependencies.advanceReviewAnalysisBackfill({
      organizationId: organizationId(payload.organizationId),
      propertyId: propertyId(payload.propertyId),
    })
  }
  return { status: receiptStatus }
}

export async function handleAiPropertyTrendGenerationRequested(
  dependencies: RegisterAiConsumersInput,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const payload = propertyTrendEventPayloadSchema.parse(event.payload)
  if (
    event.organizationId !== payload.organizationId ||
    event.propertyId !== payload.propertyId
  ) {
    throw new Error('AI property trend event routing mismatch')
  }
  await dependencies.enqueuePropertyTrend(payload.scheduleId)
  await dependencies.receipts.insertReceipt(
    event.eventId,
    AI_PROPERTY_TREND_GENERATION_CONSUMER,
    'applied',
  )
  return { status: 'applied' }
}

export function registerAiConsumers(dependencies: RegisterAiConsumersInput): void {
  registerConsumer({
    eventType: 'review.created',
    consumerName: 'ai.analyze-review-event',
    module: 'ai.outbox-consumers',
    handler: (event) => handleAiReviewEvent(dependencies, event),
  })
  registerConsumer({
    eventType: 'review.updated',
    consumerName: 'ai.analyze-review-event',
    module: 'ai.outbox-consumers',
    handler: (event) => handleAiReviewEvent(dependencies, event),
  })
  registerConsumer({
    eventType: 'review.source_transitioned',
    consumerName: 'ai.analyze-review-event',
    module: 'ai.outbox-consumers',
    handler: (event) => handleAiReviewEvent(dependencies, event),
  })
  // The audited operator backfill (`ops:ai-reanalyze`). Registered ONLY here:
  // the inbox also consumes `review.created`/`review.updated`, so replaying
  // either to reach review analysis would churn inbox items for reviews that
  // never changed. Same handler — the analysis logic is not duplicated.
  // The event type is spelled out here, not taken from the constant above: the
  // BQC-2.1/3.1 catalogue guards discover consumer wiring by parsing this call.
  registerConsumer({
    eventType: 'ai.review_analysis.backfill_requested',
    consumerName: 'ai.analyze-review-event',
    module: 'ai.outbox-consumers',
    handler: (event) => handleAiReviewEvent(dependencies, event),
  })
  registerConsumer({
    eventType: 'ai.property_trend.generation_requested',
    consumerName: 'ai.generate-property-trend',
    module: 'ai.outbox-consumers',
    handler: (event) => handleAiPropertyTrendGenerationRequested(dependencies, event),
  })
}
