import { z } from 'zod/v4'
import type {
  ConsumerEvent,
  ConsumerRegistry,
  ConsumerResult,
  OutboxRepository,
} from '#/shared/outbox'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type {
  AnalyzeReviewEventInput,
  AnalyzeReviewEventResult,
} from '../application/use-cases/analyze-review-event'
import type {
  AiAuthorizationLifecycleApplyResult,
  AiAuthorizationLifecycleTrigger,
} from '../application/ports/ai-review-analysis-enrollment.port'

export const AI_REVIEW_ANALYSIS_CONSUMER = 'ai.analyze-review-event'
export const AI_PROPERTY_TREND_GENERATION_CONSUMER = 'ai.generate-property-trend'
export const AI_REVIEW_ANALYSIS_ENROLLMENT_CONSUMER = 'ai.enroll-review-analysis'
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
const merchantAiChangedPayloadSchema = z.object({
  organizationId: z.string().min(1),
  propertyId: z.uuid(),
  authorizationLineageId: z.uuid(),
  state: z.enum(['disabled', 'enabled', 'revoked']),
  reviewAnalysisEpoch: z.number().int().positive(),
  replyDraftingEpoch: z.number().int().positive(),
  propertyTrendsEpoch: z.number().int().positive(),
  authorizedSourceEpoch: z.number().int().nonnegative(),
  analysisStartSequence: z.number().int().nonnegative(),
  stateVersion: z.number().int().positive(),
  occurredAt: z.string().min(1),
  correlationId: z.string().nullable().optional(),
})

export type RegisterAiConsumersInput = Readonly<{
  analyzeReviewEvent: (
    input: AnalyzeReviewEventInput,
  ) => Promise<AnalyzeReviewEventResult>
  receipts: OutboxRepository
  enqueuePropertyTrend: (scheduleId: string) => Promise<void>
  /**
   * Apply the Identity authorization trigger through the AI command store.
   * That store commits the enrollment intent (or exact obsolete/no-op
   * decision) and this consumer's receipt atomically.
   */
  applyAiAuthorizationLifecycle?: (
    input: AiAuthorizationLifecycleTrigger,
  ) => Promise<AiAuthorizationLifecycleApplyResult>
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

export async function handleAiAuthorizationLifecycleChanged(
  dependencies: RegisterAiConsumersInput,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const payload = merchantAiChangedPayloadSchema.parse(event.payload)
  if (
    event.organizationId !== payload.organizationId ||
    event.propertyId !== payload.propertyId
  ) {
    throw new Error('AI authorization lifecycle trigger routing mismatch')
  }
  const occurredAt = new Date(payload.occurredAt)
  if (!Number.isFinite(occurredAt.getTime())) {
    throw new Error('AI authorization lifecycle trigger timestamp is invalid')
  }
  if (!dependencies.applyAiAuthorizationLifecycle) {
    throw new Error('AI authorization lifecycle command store is unavailable')
  }
  const result = await dependencies.applyAiAuthorizationLifecycle({
    eventEnvelopeId: event.eventId,
    organizationId: organizationId(payload.organizationId),
    propertyId: propertyId(payload.propertyId),
    authorizationState: payload.state,
    fence: {
      authorizationLineageId: payload.authorizationLineageId,
      authorizationStateVersion: payload.stateVersion,
      sourceEpoch: payload.authorizedSourceEpoch,
      reviewAnalysisEpoch: payload.reviewAnalysisEpoch,
      replyDraftingEpoch: payload.replyDraftingEpoch,
      propertyTrendsEpoch: payload.propertyTrendsEpoch,
      analysisStartSequence: payload.analysisStartSequence,
    },
    correlationId: payload.correlationId ?? event.correlationId ?? null,
    occurredAt,
  })
  return {
    status:
      result.status === 'obsolete'
        ? 'obsolete'
        : result.status === 'duplicate'
          ? 'duplicate'
          : 'applied',
  }
}

export function registerAiConsumers(
  registry: ConsumerRegistry,
  dependencies: RegisterAiConsumersInput,
): void {
  const { registerConsumer } = registry
  if (dependencies.applyAiAuthorizationLifecycle) {
    registerConsumer({
      eventType: 'identity.merchant_ai.changed',
      consumerName: 'ai.enroll-review-analysis',
      module: 'ai.outbox-consumers',
      handler: (event) => handleAiAuthorizationLifecycleChanged(dependencies, event),
    })
  }
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
