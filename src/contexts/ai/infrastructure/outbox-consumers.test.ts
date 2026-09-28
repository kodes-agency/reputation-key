import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import {
  createDelayedExecutionPolicy,
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
import { ENTRY_POINT_CATALOGUE } from '#/shared/governance/entry-point-catalogue'
import { gateDispatcherConsumer } from '#/shared/jobs/delayed-execution-gate'
import type { ConsumerEvent } from '#/shared/outbox/consumer-registry'
import { createConsumerRegistry, type OutboxRepository } from '#/shared/outbox'
import { DISPATCH_JOB_OPTIONS } from '#/shared/outbox/dispatch-job-options'
import { organizationId, propertyId } from '#/shared/domain/ids'
import {
  AI_ANALYSIS_OPERATION_HORIZON_MILLIS,
  AI_BACKFILL_OPERATION_HORIZON_MILLIS,
  type AnalyzeReviewEventResult,
} from '../application/use-cases/analyze-review-event'
import policySource from '../domain/catalogues/ai-private-beta-policy-v1.json'
import {
  AI_PROPERTY_TREND_GENERATION_CONSUMER,
  AI_REVIEW_ANALYSIS_ENROLLMENT_CONSUMER,
  AI_REVIEW_ANALYSIS_CONSUMER,
  handleAiAuthorizationLifecycleChanged,
  handleAiPropertyTrendGenerationRequested,
  handleAiReviewEvent,
  registerAiConsumers,
  type RegisterAiConsumersInput,
} from './outbox-consumers'

const EVENT_ID = '71000000-0000-4000-8000-000000000201'
const PROPERTY_ID = '71000000-0000-4000-8000-000000000202'
const REVIEW_ID = '71000000-0000-4000-8000-000000000203'
const ORGANIZATION_ID = 'ai-review-consumer-test'
const RECORDED_AT = '2026-08-16T12:00:00.000Z'

function event(
  eventType:
    | 'review.created'
    | 'review.updated'
    | 'review.source_transitioned'
    | 'ai.review_analysis.backfill_requested',
  change?: 'source_expired' | 'provider_deleted',
  observationOrigin?: 'ongoing' | 'historical_onboarding',
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
      ...(observationOrigin ? { observationOrigin } : {}),
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
  const enqueue = vi.fn(async () => {})
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
  const advanceEnrollment = vi.fn<
    NonNullable<RegisterAiConsumersInput['advanceEnrollment']>
  >(async () => ({ status: 'replay_started' }))
  const logger = { warn: vi.fn() }
  const dependencies = {
    analyzeReviewEvent,
    enqueuePropertyTrend,
    applyAiAuthorizationLifecycle,
    advanceEnrollment,
    receipts: { insertReceipt } as unknown as OutboxRepository,
    backlog: { enqueue },
    nowEpochMillis: () => Date.parse(RECORDED_AT) + 1_000,
    logger,
  } satisfies RegisterAiConsumersInput
  return {
    dependencies,
    analyzeReviewEvent,
    enqueuePropertyTrend,
    applyAiAuthorizationLifecycle,
    advanceEnrollment,
    insertReceipt,
    enqueue,
    logger,
  }
}

function trendEvent(): ConsumerEvent {
  return {
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
  it('analyzes an event and records its receipt', async () => {
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
      operationHorizonMillis: AI_ANALYSIS_OPERATION_HORIZON_MILLIS,
      execution: 'execute',
      lane: 'background',
    })
    expect(test.enqueue).not.toHaveBeenCalled()
    expect(test.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      AI_REVIEW_ANALYSIS_CONSUMER,
      'applied',
    )
  })

  it('gives a backfill event the backfill horizon', async () => {
    const test = harness({ status: 'completed' })

    await expect(
      handleAiReviewEvent(
        test.dependencies,
        event('ai.review_analysis.backfill_requested'),
      ),
    ).resolves.toEqual({ status: 'applied' })
    expect(test.analyzeReviewEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        disposition: 'pending',
        operationHorizonMillis: AI_BACKFILL_OPERATION_HORIZON_MILLIS,
        execution: 'defer',
      }),
    )
  })

  it.each([
    ['ai.review_analysis.backfill_requested', undefined, 'backfill'],
    ['review.created', 'historical_onboarding', 'historical_onboarding'],
    ['review.updated', 'historical_onboarding', 'historical_onboarding'],
  ] as const)(
    'queues %s history for the background lane and receipts the event',
    async (eventType, observationOrigin, origin) => {
      const test = harness({ status: 'deferred' })

      await expect(
        handleAiReviewEvent(
          test.dependencies,
          event(eventType, undefined, observationOrigin),
        ),
      ).resolves.toEqual({ status: 'applied' })
      expect(test.analyzeReviewEvent).toHaveBeenCalledWith(
        expect.objectContaining({ execution: 'defer', lane: 'background' }),
      )
      expect(test.enqueue).toHaveBeenCalledWith({
        eventEnvelopeId: EVENT_ID,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_ID,
        sourceEpoch: 2,
        sourceRevision: 5,
        analysisSequence: 7,
        origin,
        nowEpochMillis: Date.parse(RECORDED_AT) + 1_000,
      })
      expect(test.insertReceipt).toHaveBeenCalledWith(
        EVENT_ID,
        AI_REVIEW_ANALYSIS_CONSUMER,
        'applied',
      )
    },
  )

  it('analyses an ongoing review on delivery', async () => {
    const test = harness({ status: 'completed' })

    await handleAiReviewEvent(
      test.dependencies,
      event('review.created', undefined, 'ongoing'),
    )

    expect(test.analyzeReviewEvent).toHaveBeenCalledWith(
      expect.objectContaining({ execution: 'execute' }),
    )
    expect(test.enqueue).not.toHaveBeenCalled()
  })

  it('queues a live review whose background lane was busy instead of redelivering it', async () => {
    const test = harness({
      status: 'retry',
      retryAtEpochMillis: Date.parse(RECORDED_AT) + 30_000,
      code: 'admission_busy',
    })

    await expect(
      handleAiReviewEvent(test.dependencies, event('review.created')),
    ).resolves.toEqual({ status: 'applied' })
    expect(test.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventEnvelopeId: EVENT_ID, origin: 'deferred_live' }),
    )
    expect(test.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      AI_REVIEW_ANALYSIS_CONSUMER,
      'applied',
    )
  })

  it('receipts an already-handled replay as applied', async () => {
    const test = harness({ status: 'replayed' })

    await expect(
      handleAiReviewEvent(test.dependencies, event('review.updated')),
    ).resolves.toEqual({ status: 'applied' })
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

    await expect(
      handleAiPropertyTrendGenerationRequested(test.dependencies, trendEvent()),
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

  it('leaves retryable events unreceipted', async () => {
    const test = harness({
      status: 'retry',
      retryAtEpochMillis: 1,
      code: 'provider_unavailable',
    })

    await expect(
      handleAiReviewEvent(test.dependencies, event('review.updated')),
    ).rejects.toThrow('AI review analysis retry required: provider_unavailable')
    expect(test.enqueuePropertyTrend).not.toHaveBeenCalled()
    expect(test.insertReceipt).not.toHaveBeenCalled()
  })

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

  it('opens a freshly queued enrollment on delivery, not at the next sweep', async () => {
    const test = harness({ status: 'completed' })

    await expect(
      handleAiAuthorizationLifecycleChanged(test.dependencies, merchantAiChangedEvent()),
    ).resolves.toEqual({ status: 'applied' })

    expect(test.advanceEnrollment).toHaveBeenCalledOnce()
    expect(test.advanceEnrollment).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
    })
  })

  it.each([
    [
      'a replayed trigger',
      { status: 'duplicate', enrollmentId: '71000000-0000-4000-8000-000000000205' },
    ],
    [
      'an obsolete generation',
      { status: 'obsolete', reason: 'authorization_state_version_changed' },
    ],
    [
      'a trigger that enrols nothing',
      {
        status: 'applied',
        enrollment: { status: 'not_applicable', reason: 'authorization_not_enabled' },
      },
    ],
    [
      'an enrollment awaiting assisted approval',
      {
        status: 'applied',
        enrollment: {
          status: 'awaiting_assisted_approval',
          enrollmentId: '71000000-0000-4000-8000-000000000205',
          eligibleRevisionCount: 10_001,
          safetyCeiling: 10_000,
        },
      },
    ],
  ] as const)('leaves %s to the enrollment sweep', async (_case, applied) => {
    const test = harness({ status: 'completed' })
    test.applyAiAuthorizationLifecycle.mockResolvedValueOnce(applied)

    await handleAiAuthorizationLifecycleChanged(
      test.dependencies,
      merchantAiChangedEvent(),
    )

    expect(test.advanceEnrollment).not.toHaveBeenCalled()
  })

  it('keeps the applied result when opening the enrollment fails, and records it', async () => {
    const test = harness({ status: 'completed' })
    const failure = new Error('enrollment store unavailable')
    test.advanceEnrollment.mockRejectedValueOnce(failure)

    await expect(
      handleAiAuthorizationLifecycleChanged(test.dependencies, merchantAiChangedEvent()),
    ).resolves.toEqual({ status: 'applied' })

    expect(test.logger.warn).toHaveBeenCalledOnce()
    expect(test.logger.warn).toHaveBeenCalledWith(
      { err: failure, organizationId: ORGANIZATION_ID, propertyId: PROPERTY_ID },
      'AI review analysis enrollment advance failed',
    )
  })
})

// The dispatcher authorizes each consumer under its own catalogue row, and a
// terminal denial records an obsolete receipt that is never retried. Every AI
// consumer used to share the trends row, so stopping trends (ai.detect_trends)
// lost Review Analysis and enrollment deliveries for good, while stopping
// analysis (ai.analyze) left the analysis consumer running.
describe('AI consumer authorization', () => {
  const platformCapabilityOf = (id: string): string | undefined =>
    policySource.capabilities.find((capability) => capability.id === id)
      ?.platformCapability

  const registrations = () => {
    const registry = createConsumerRegistry()
    registerAiConsumers(registry, harness({ status: 'completed' }).dependencies)
    return [...new Set(registry.list().map(({ eventType }) => eventType))].flatMap(
      (eventType) => registry.listFor(eventType),
    )
  }

  /** The reason the real delayed policy gives one consumer under a capability stop. */
  const gateUnderStop = async (
    stopped: string,
    consumerName: string,
    envelope: ConsumerEvent,
  ): Promise<string> => {
    initCapabilityPolicyStore(
      createEnvCapabilityPolicyStore({
        BETA_ALLOWLIST_ORGS: ORGANIZATION_ID,
        BETA_CAPABILITIES_OFF: stopped,
      }),
    )
    const registration = registrations().find(
      (candidate) =>
        candidate.eventType === envelope.eventType &&
        candidate.consumerName === consumerName,
    )
    const outcome = await gateDispatcherConsumer(
      consumerName,
      registration!.module,
      envelope,
    )
    return outcome.decision.reason
  }

  beforeEach(() => {
    initDelayedExecutionPolicy(
      createDelayedExecutionPolicy({ refreshPolicy: async () => {} }),
    )
  })

  afterEach(() => {
    resetDelayedExecutionPolicy()
    resetCapabilityPolicyStore()
  })

  it('gates each consumer on the platform capability of the AI capability it serves', () => {
    // Enrollment is ungated: it records the merchant's enable, disable or
    // revoke, which no stop may lose, and the provider work it leads to is
    // gated on ai.analyze further on.
    const served: Readonly<Record<string, string | undefined>> = {
      [AI_REVIEW_ANALYSIS_CONSUMER]: platformCapabilityOf('review_analysis'),
      [AI_PROPERTY_TREND_GENERATION_CONSUMER]: platformCapabilityOf('property_trends'),
      [AI_REVIEW_ANALYSIS_ENROLLMENT_CONSUMER]: 'none',
    }
    const routes = registrations().map(({ eventType, consumerName, module }) => ({
      route: `${eventType} → ${consumerName}`,
      consumerName,
      gate: ENTRY_POINT_CATALOGUE.find(
        (row) => row.kind === 'consumer' && row.name === module,
      )?.capability,
    }))

    expect(new Set(routes.map(({ consumerName }) => consumerName))).toEqual(
      new Set(Object.keys(served)),
    )
    expect(
      routes
        .filter(({ consumerName, gate }) => gate !== served[consumerName])
        .map(({ route, gate }) => `${route}: ${gate}`),
    ).toEqual([])
  })

  it('keeps analysing reviews and recording enrollment while trends are stopped', async () => {
    const stopped = 'ai.detect_trends'

    expect({
      analysis: await gateUnderStop(
        stopped,
        AI_REVIEW_ANALYSIS_CONSUMER,
        event('review.created'),
      ),
      enrollment: await gateUnderStop(
        stopped,
        AI_REVIEW_ANALYSIS_ENROLLMENT_CONSUMER,
        merchantAiChangedEvent(),
      ),
      trends: await gateUnderStop(
        stopped,
        AI_PROPERTY_TREND_GENERATION_CONSUMER,
        trendEvent(),
      ),
    }).toEqual({
      analysis: 'allowed',
      enrollment: 'allowed',
      trends: 'capability_disabled',
    })
  })

  it('stops Review Analysis, but not enrollment, when analysis is stopped', async () => {
    const stopped = 'ai.analyze'

    expect({
      analysis: await gateUnderStop(
        stopped,
        AI_REVIEW_ANALYSIS_CONSUMER,
        event('review.created'),
      ),
      enrollment: await gateUnderStop(
        stopped,
        AI_REVIEW_ANALYSIS_ENROLLMENT_CONSUMER,
        merchantAiChangedEvent(),
      ),
    }).toEqual({ analysis: 'capability_disabled', enrollment: 'allowed' })
  })
})
