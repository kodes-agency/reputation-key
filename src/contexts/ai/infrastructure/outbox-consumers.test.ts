import { describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox/consumer-registry'
import type { OutboxRepository } from '#/shared/outbox'
import { DISPATCH_JOB_OPTIONS } from '#/shared/outbox/relay'
import { organizationId, propertyId } from '#/shared/domain/ids'
import {
  AI_ANALYSIS_OPERATION_HORIZON_MILLIS,
  type AnalyzeReviewEventResult,
} from '../application/use-cases/analyze-review-event'
import {
  AI_PROPERTY_TREND_GENERATION_CONSUMER,
  AI_REVIEW_ANALYSIS_ENROLLMENT_CONSUMER,
  AI_REVIEW_ANALYSIS_CONSUMER,
  handleAiAuthorizationLifecycleChanged,
  handleAiPropertyTrendGenerationRequested,
  handleAiReviewEvent,
  type RegisterAiConsumersInput,
} from './outbox-consumers'

const EVENT_ID = '71000000-0000-4000-8000-000000000201'
const PROPERTY_ID = '71000000-0000-4000-8000-000000000202'
const REVIEW_ID = '71000000-0000-4000-8000-000000000203'
const ORGANIZATION_ID = 'ai-review-consumer-test'
const RECORDED_AT = '2026-08-16T12:00:00.000Z'

function event(
  eventType: 'review.created' | 'review.updated' | 'review.source_transitioned',
  change?: 'source_expired' | 'provider_deleted',
): ConsumerEvent {
  return {
    eventId: EVENT_ID,
    eventType,
    eventVersion: 1,
    payload: {
      organizationId: organizationId(ORGANIZATION_ID),
      propertyId: propertyId(PROPERTY_ID),
      reviewId: REVIEW_ID,
      sourceEpoch: 2,
      sourceRevision: 5,
      analysisSequence: 7,
      ...(change ? { change } : {}),
    },
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    sourceContext: 'review',
    sourceAggregateId: REVIEW_ID,
    recordedAt: RECORDED_AT,
  }
}

function harness(result: AnalyzeReviewEventResult) {
  const analyzeReviewEvent = vi.fn(async () => result)
  const enqueuePropertyTrend = vi.fn(async () => {})
  const insertReceipt = vi.fn(async () => {})
  const applyAiAuthorizationLifecycle = vi.fn<
    NonNullable<RegisterAiConsumersInput['applyAiAuthorizationLifecycle']>
  >(async () => ({
    status: 'applied' as const,
    lifecycle: {
      id: '71000000-0000-4000-8000-000000000207',
      eventEnvelopeId: EVENT_ID,
      organizationId: organizationId(ORGANIZATION_ID),
      propertyId: propertyId(PROPERTY_ID),
      authorizationState: 'enabled' as const,
      transitionKind: 'change' as const,
      fence: {
        authorizationLineageId: '71000000-0000-4000-8000-000000000206',
        authorizationStateVersion: 4,
        sourceEpoch: 2,
        reviewAnalysisEpoch: 3,
        replyDraftingEpoch: 2,
        propertyTrendsEpoch: 2,
        analysisStartSequence: 19,
      },
      authorizedCapabilities: ['review_analysis'] as const,
      visibleDataClasses: ['review_analysis', 'property_aggregate'] as const,
      retiredDataClasses: [] as const,
      erasureStatus: 'not_required' as const,
      erasureDeadlineEpochMillis: null,
      appliedAtEpochMillis: Date.parse(RECORDED_AT),
    },
    enrollment: {
      status: 'queued' as const,
      enrollmentId: '71000000-0000-4000-8000-000000000205',
    },
  }))
  const dependencies = {
    analyzeReviewEvent,
    enqueuePropertyTrend,
    applyAiAuthorizationLifecycle,
    receipts: { insertReceipt } as unknown as OutboxRepository,
  } satisfies RegisterAiConsumersInput
  return {
    dependencies,
    analyzeReviewEvent,
    enqueuePropertyTrend,
    applyAiAuthorizationLifecycle,
    insertReceipt,
  }
}

function merchantAiChangedEvent(): ConsumerEvent {
  return {
    eventId: EVENT_ID,
    eventType: 'identity.merchant_ai.changed',
    eventVersion: 1,
    payload: {
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      authorizationLineageId: '71000000-0000-4000-8000-000000000206',
      state: 'enabled',
      reviewAnalysisEpoch: 3,
      replyDraftingEpoch: 2,
      propertyTrendsEpoch: 2,
      authorizedSourceEpoch: 2,
      analysisStartSequence: 19,
      stateVersion: 4,
      occurredAt: RECORDED_AT,
      correlationId: null,
    },
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    sourceContext: 'identity',
    sourceAggregateId: PROPERTY_ID,
    recordedAt: RECORDED_AT,
  }
}

describe('AI review outbox consumer', () => {
  it('analyzes an ordered event and records its receipt', async () => {
    const test = harness({ status: 'completed' })

    await expect(
      handleAiReviewEvent(test.dependencies, event('review.updated')),
    ).resolves.toEqual({ status: 'applied' })
    expect(test.analyzeReviewEvent).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
      sourceEpoch: 2,
      sourceRevision: 5,
      analysisSequence: 7,
      eventEnvelopeId: EVENT_ID,
      disposition: 'pending',
      eventRecordedAtEpochMillis: Date.parse(RECORDED_AT),
    })
    expect(test.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      AI_REVIEW_ANALYSIS_CONSUMER,
      'applied',
    )
  })

  it('analyzes events carrying the envelope fields the producer actually emits', async () => {
    // Real google-closed-beta payload: the registry adds `platform` and
    // `occurredAt`, and every emitted event carries `correlationId`. A strict
    // consumer schema rejected all three, so no review was ever analyzed.
    const test = harness({ status: 'completed' })
    const emitted = {
      ...event('review.created'),
      payload: {
        platform: 'google',
        reviewId: REVIEW_ID,
        occurredAt: '2026-08-19T10:07:34.800Z',
        propertyId: PROPERTY_ID,
        sourceEpoch: 0,
        correlationId: null,
        organizationId: ORGANIZATION_ID,
        sourceRevision: 1,
        analysisSequence: 256,
      },
    }

    await expect(handleAiReviewEvent(test.dependencies, emitted)).resolves.toEqual({
      status: 'applied',
    })
    expect(test.analyzeReviewEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceEpoch: 0,
        sourceRevision: 1,
        analysisSequence: 256,
      }),
    )
  })

  it('maps source transitions to terminal dispositions', async () => {
    const test = harness({ status: 'terminal' })

    await handleAiReviewEvent(
      test.dependencies,
      event('review.source_transitioned', 'provider_deleted'),
    )

    expect(test.analyzeReviewEvent).toHaveBeenCalledWith(
      expect.objectContaining({ disposition: 'provider_deleted' }),
    )
  })

  it('records generation changes as obsolete without scheduling trends', async () => {
    const test = harness({ status: 'generation_changed' })

    await expect(
      handleAiReviewEvent(test.dependencies, event('review.created')),
    ).resolves.toEqual({ status: 'obsolete' })
    expect(test.enqueuePropertyTrend).not.toHaveBeenCalled()
    expect(test.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      AI_REVIEW_ANALYSIS_CONSUMER,
      'obsolete',
    )
  })

  it('enqueues the exact scheduled trend and records its receipt', async () => {
    const test = harness({ status: 'completed' })
    const trendEvent: ConsumerEvent = {
      eventId: EVENT_ID,
      eventType: 'ai.property_trend.generation_requested',
      eventVersion: 1,
      payload: {
        scheduleId: '71000000-0000-4000-8000-000000000204',
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
      },
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceContext: 'ai',
      sourceAggregateId: '71000000-0000-4000-8000-000000000204',
    }

    await expect(
      handleAiPropertyTrendGenerationRequested(test.dependencies, trendEvent),
    ).resolves.toEqual({ status: 'applied' })
    expect(test.enqueuePropertyTrend).toHaveBeenCalledWith(
      '71000000-0000-4000-8000-000000000204',
    )
    expect(test.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      AI_PROPERTY_TREND_GENERATION_CONSUMER,
      'applied',
    )
    expect(test.analyzeReviewEvent).not.toHaveBeenCalled()
  })

  it.each([
    { result: { status: 'retry', retryAtEpochMillis: 1, code: 'provider_unavailable' } },
    { result: { status: 'gap', expectedSequence: 6 } },
  ] satisfies ReadonlyArray<{ result: AnalyzeReviewEventResult }>)(
    'leaves retryable or out-of-order events unreceipted: $result.status',
    async ({ result }) => {
      const test = harness(result)

      await expect(
        handleAiReviewEvent(test.dependencies, event('review.updated')),
      ).rejects.toThrow(
        result.status === 'retry'
          ? 'AI review analysis retry required: provider_unavailable'
          : 'AI review analysis sequence gap',
      )
      expect(test.enqueuePropertyTrend).not.toHaveBeenCalled()
      expect(test.insertReceipt).not.toHaveBeenCalled()
    },
  )

  it('anchors the operation horizon on recordedAt, falling back to occurredAt', async () => {
    const test = harness({ status: 'completed' })
    const occurredOnly = { ...event('review.created'), recordedAt: undefined }
    const neither = { ...occurredOnly, occurredAt: undefined }

    await handleAiReviewEvent(test.dependencies, {
      ...event('review.created'),
      occurredAt: '2020-01-01T00:00:00.000Z',
    })
    expect(test.analyzeReviewEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ eventRecordedAtEpochMillis: Date.parse(RECORDED_AT) }),
    )

    await handleAiReviewEvent(test.dependencies, {
      ...occurredOnly,
      occurredAt: '2020-01-01T00:00:00.000Z',
    })
    expect(test.analyzeReviewEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        eventRecordedAtEpochMillis: Date.parse('2020-01-01T00:00:00.000Z'),
      }),
    )

    await handleAiReviewEvent(test.dependencies, neither)
    expect(test.analyzeReviewEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ eventRecordedAtEpochMillis: null }),
    )
  })

  it('gives the analysis consumer a dispatch budget that outlasts its operation horizon', () => {
    // Budget alignment: the domain terminal-settles a provider failure only on
    // its 4th attempt, and pre-attempt deferrals (quota, lease, runtime drift,
    // missing profile) consume dispatch attempts without consuming a domain
    // attempt. BullMQ's exponential backoff with jitter j waits at least
    // (1 - j) * delay * 2^(n-1) before attempt n+1, so the attempt before the
    // last must already be past the horizon.
    const { attempts, backoff } = DISPATCH_JOB_OPTIONS
    let minimumElapsedBeforePenultimateAttempt = 0
    for (let attempt = 1; attempt < attempts - 1; attempt += 1) {
      minimumElapsedBeforePenultimateAttempt +=
        (1 - backoff.jitter) * backoff.delay * 2 ** (attempt - 1)
    }

    expect(attempts).toBeGreaterThan(4)
    expect(minimumElapsedBeforePenultimateAttempt).toBeGreaterThan(
      AI_ANALYSIS_OPERATION_HORIZON_MILLIS,
    )
  })
})

describe('AI authorization lifecycle consumer', () => {
  it('applies the complete authorization generation before enrollment', async () => {
    const test = harness({ status: 'completed' })

    await expect(
      handleAiAuthorizationLifecycleChanged(test.dependencies, merchantAiChangedEvent()),
    ).resolves.toEqual({ status: 'applied' })

    expect(test.applyAiAuthorizationLifecycle).toHaveBeenCalledWith({
      eventEnvelopeId: EVENT_ID,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      authorizationState: 'enabled',
      fence: {
        authorizationLineageId: '71000000-0000-4000-8000-000000000206',
        authorizationStateVersion: 4,
        sourceEpoch: 2,
        reviewAnalysisEpoch: 3,
        replyDraftingEpoch: 2,
        propertyTrendsEpoch: 2,
        analysisStartSequence: 19,
      },
      correlationId: null,
      occurredAt: new Date(RECORDED_AT),
    })
    // The enrollment command store owns state + receipt atomically. A second
    // standalone receipt here would recreate the crash window this trigger is
    // meant to close.
    expect(test.insertReceipt).not.toHaveBeenCalledWith(
      EVENT_ID,
      AI_REVIEW_ANALYSIS_ENROLLMENT_CONSUMER,
      expect.anything(),
    )
  })

  it('receipts a delayed authorization generation as obsolete', async () => {
    const test = harness({ status: 'completed' })
    test.applyAiAuthorizationLifecycle.mockResolvedValueOnce({
      status: 'obsolete',
      reason: 'authorization_state_version_changed',
    })

    await expect(
      handleAiAuthorizationLifecycleChanged(test.dependencies, merchantAiChangedEvent()),
    ).resolves.toEqual({ status: 'obsolete' })
  })

  it.each(['enabled', 'disabled', 'revoked'] as const)(
    'accepts the identifier-only %s lifecycle state',
    async (authorizationState) => {
      const test = harness({ status: 'completed' })
      const changed = merchantAiChangedEvent()

      await expect(
        handleAiAuthorizationLifecycleChanged(test.dependencies, {
          ...changed,
          payload: {
            ...(changed.payload as Readonly<Record<string, unknown>>),
            state: authorizationState,
          },
        }),
      ).resolves.toEqual({ status: 'applied' })

      expect(test.applyAiAuthorizationLifecycle).toHaveBeenCalledWith(
        expect.objectContaining({ authorizationState }),
      )
    },
  )

  it('maps a replayed lifecycle command to a duplicate consumer result', async () => {
    const test = harness({ status: 'completed' })
    test.applyAiAuthorizationLifecycle.mockResolvedValueOnce({
      status: 'duplicate',
      enrollmentId: '71000000-0000-4000-8000-000000000205',
    })

    await expect(
      handleAiAuthorizationLifecycleChanged(test.dependencies, merchantAiChangedEvent()),
    ).resolves.toEqual({ status: 'duplicate' })
  })
})
