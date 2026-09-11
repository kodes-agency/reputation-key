import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { MERCHANT_AI_NOTICE_VERSION } from '#/shared/merchant-ai-notice-contract'
import type {
  AiOperationRecord,
  AiOperationStorePort,
} from '../ports/ai-operation-store.port'
import type { AiPropertyProfileResult } from '../../domain/types'
import type { AnalyzeReviewEventDependencies } from './analyze-review-event'
import {
  AI_ANALYSIS_OPERATION_HORIZON_MILLIS,
  AI_BACKFILL_OPERATION_HORIZON_MILLIS,
  createAnalyzeReviewEvent,
  derivePrimaryCategoryV1,
} from './analyze-review-event'
import type { AiErrorCode } from '../../domain/errors'
import type { AiOperationId } from '../../domain/types'
import {
  AI_REVIEW_LANGUAGE_ICU_VERSION,
  AI_REVIEW_LANGUAGE_UNICODE_VERSION,
} from '#/shared/ai-review-language-catalogue'
import { AI_REVIEW_LANGUAGE_REGION_NODE_VERSION } from '#/shared/generated/ai-review-language-canonical-regions-v1'

/**
 * `mapReviewLanguageMetadata` fails closed unless the process matches the pinned
 * node/ICU/Unicode triple, which is asserted at image build time (Dockerfile), so
 * BOTH branches must be exercised here.
 *
 * Both are stubbed on purpose. An earlier version left the drift branch un-stubbed
 * and relied on "this machine's runtime deliberately differs from the pin" — which
 * inverts on any host that happens to match it. CI runs the pinned Node, so the
 * drift tests saw no drift, took the happy path and returned `completed`. A test
 * whose verdict depends on which machine runs it is not a test.
 */
function withPinnedLanguageRuntime(): void {
  stubProcessVersions({
    node: AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
    icu: AI_REVIEW_LANGUAGE_ICU_VERSION,
    unicode: AI_REVIEW_LANGUAGE_UNICODE_VERSION.replace(/\.0$/u, ''),
  })
}

/** Forces real drift regardless of host, by moving ICU off the pinned value. */
function withDriftedLanguageRuntime(): void {
  stubProcessVersions({
    node: AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
    icu: `${Number.parseInt(AI_REVIEW_LANGUAGE_ICU_VERSION, 10) + 1}.0`,
    unicode: AI_REVIEW_LANGUAGE_UNICODE_VERSION.replace(/\.0$/u, ''),
  })
}

function stubProcessVersions(overrides: Readonly<Record<string, string>>): void {
  Object.defineProperty(process, 'versions', {
    value: { ...process.versions, ...overrides },
    configurable: true,
    writable: false,
    enumerable: true,
  })
}

const ACTUAL_VERSIONS = process.versions
afterEach(() => {
  Object.defineProperty(process, 'versions', {
    value: ACTUAL_VERSIONS,
    configurable: true,
    writable: false,
    enumerable: true,
  })
})

const NOW = Date.parse('2026-08-16T12:00:00.000Z')
const ORGANIZATION_ID = organizationId('ai-analysis-workflow-test')
const PROPERTY_ID = propertyId('71000000-0000-4000-8000-000000000101')
const REVIEW_ID = reviewId('71000000-0000-4000-8000-000000000102')
const OPERATION_ID = '71000000-0000-4000-8000-000000000103' as AiOperationId
const PERMIT_ID = '71000000-0000-4000-8000-000000000104'
const LINEAGE_ID = '71000000-0000-4000-8000-000000000105'
const SHA = 'a'.repeat(64)
const VALID_ANALYSIS_RESULT = Object.freeze({
  sentiment: 'negative' as const,
  sentimentValence: -90,
  urgencySignals: Object.freeze(['health'] as const),
  aspects: Object.freeze([
    Object.freeze({
      aspect: 'service' as const,
      polarity: 'negative' as const,
      intensity: -90,
    }),
  ]),
  issueLabel: 'service recovery',
})

const input = Object.freeze({
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  reviewId: REVIEW_ID,
  sourceEpoch: 2,
  sourceRevision: 5,
  analysisSequence: 7,
  eventEnvelopeId: '71000000-0000-4000-8000-000000000106',
  disposition: 'pending' as const,
  eventRecordedAtEpochMillis: NOW,
  operationHorizonMillis: AI_ANALYSIS_OPERATION_HORIZON_MILLIS,
})
/** The same event, redelivered after its bounded operation horizon elapsed. */
const elapsedInput = Object.freeze({
  ...input,
  eventRecordedAtEpochMillis: NOW - AI_ANALYSIS_OPERATION_HORIZON_MILLIS,
})
/** A backfill event as old as the live horizon: still well inside its own. */
const agedBackfillInput = Object.freeze({
  ...elapsedInput,
  operationHorizonMillis: AI_BACKFILL_OPERATION_HORIZON_MILLIS,
})

function createHarness(
  options: Readonly<{
    languageCode?: string | null
    operationState?: AiOperationRecord['state']
    settleOutcome?: boolean
    aggregateStatus?: 'applied' | 'stale' | 'unavailable'
    profileStatus?: Exclude<AiPropertyProfileResult['status'], 'available'>
    quotaCode?: string
    /** Simulates a redelivery of an operation claimed in an earlier attempt. */
    operationCreatedAtEpochMillis?: number
    analysisResult?: unknown
    rating?: 1 | 2 | 3 | 4 | 5
    consumeStatus?: 'accepted' | 'duplicate' | 'generation_changed'
    /** No merchant_ai_enablement row: the property has never enabled AI. */
    authorization?: 'absent'
    /** Redelivery of an operation that already ran this many provider attempts. */
    operationExecutionAttempt?: number
    /** The failure code the last of those attempts recorded. */
    operationFailureCode?: AiErrorCode
    /** Make the provider answer with this error instead of a result. */
    providerError?: Readonly<{ code: AiErrorCode; retryAfterEpochMillis: number | null }>
  }> = {},
) {
  let claimedOperation: AiOperationRecord | undefined
  const claim = vi.fn<AiOperationStorePort['claim']>(async (request) => {
    claimedOperation = {
      id: OPERATION_ID,
      identity: request.identity,
      binding: request.binding,
      idempotencyKey: request.idempotencyKey,
      requestFingerprint: request.requestFingerprint,
      sourceProvenance: null,
      state: options.operationState ?? 'pending',
      executionAttempt:
        options.operationExecutionAttempt ??
        (options.operationState === 'succeeded_pending_delivery' ||
        options.operationState === 'succeeded'
          ? 1
          : 0),
      executionPermitId:
        options.operationState === 'succeeded_pending_delivery' ||
        options.operationState === 'succeeded'
          ? PERMIT_ID
          : null,
      nextAttemptAtEpochMillis: null,
      failureCode: options.operationFailureCode ?? null,
      createdAtEpochMillis:
        options.operationCreatedAtEpochMillis ?? request.nowEpochMillis,
      updatedAtEpochMillis: request.nowEpochMillis,
      expiresAtEpochMillis: request.expiresAtEpochMillis,
    }
    return { status: 'created', operation: claimedOperation }
  })
  const claimExecution = vi.fn<AiOperationStorePort['claimExecution']>(async () => {
    if (!claimedOperation) return null
    claimedOperation = {
      ...claimedOperation,
      state: 'executing',
      executionAttempt: claimedOperation.executionAttempt + 1,
      executionPermitId: PERMIT_ID,
    }
    return claimedOperation
  })
  const recordFailure = vi.fn<AiOperationStorePort['recordFailure']>(async () => true)
  const markDelivered = vi.fn<AiOperationStorePort['markDelivered']>(async () => true)
  const storeAnalysis = vi.fn(async () => true)
  const settleOutcome = vi.fn(async () =>
    options.settleOutcome === false
      ? null
      : { terminalAnalysisSequence: 7, aggregateRevision: 4 },
  )
  const applyReviewAnalysis = vi.fn(async () => {
    const status = options.aggregateStatus ?? 'applied'
    if (status === 'applied') return { status, aggregateRevision: 4 } as const
    return { status } as const
  })
  const advanceWithoutAnalysis = vi.fn(async () => ({
    status: 'applied' as const,
    aggregateRevision: 4,
  }))
  const analyzeReview = vi.fn(async () =>
    options.providerError
      ? {
          route: 'review-analysis' as const,
          status: 'error' as const,
          code: options.providerError.code,
          retryAfterEpochMillis: options.providerError.retryAfterEpochMillis,
        }
      : {
          route: 'review-analysis' as const,
          status: 'success' as const,
          result: options.analysisResult ?? VALID_ANALYSIS_RESULT,
          settlementReceipt: {
            version: 'ai-settlement-receipt-v1' as const,
            receiptKid: 'receipt_v1',
            grantKid: 'grant_v1',
            operationId: OPERATION_ID,
            permitId: PERMIT_ID,
            attemptNumber: 1,
            nonce: 'AQIDBA',
            requestBindingHmac: 'A'.repeat(43),
            disposition: 'success' as const,
            reportedDisposition: 'success' as const,
            providerRetryable: false,
            usageKnown: true,
            inputTokens: 100,
            cachedInputTokens: 10,
            outputTokens: 20,
            reasoningTokens: 5,
            costMicros: 42,
            settledAtEpochMillis: NOW + 1_000,
            settlementState: 'settled' as const,
            receiptSignature: 'A'.repeat(86),
          },
        },
  )
  const release = vi.fn(async () => {})
  const readReviewSource = vi.fn(async () => ({
    status: 'available' as const,
    observation: {
      kind: 'review' as const,
      reviewId: REVIEW_ID,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      text: 'The kitchen made several guests sick.',
      rating: options.rating ?? 1,
      languageCode: options.languageCode === undefined ? 'en-US' : options.languageCode,
      reviewedAtEpochMillis: NOW - 1_000,
      contentExpiresAtEpochMillis: NOW + 60_000,
      sourceEpoch: 2,
      sourceRevision: 5,
      analysisSequence: 7,
    },
  }))
  const readProcessingProfile = vi.fn(async () =>
    options.profileStatus === undefined
      ? {
          status: 'available' as const,
          profile: {
            organizationId: ORGANIZATION_ID,
            propertyId: PROPERTY_ID,
            countryCode: 'US',
            timezone: 'America/New_York',
            processingRegion: 'global' as const,
            routingPolicyVersion: 1,
            sourceEpoch: 2,
            profileVersion: 3,
            lifecycleState: 'active' as const,
          },
        }
      : { status: options.profileStatus },
  )

  const consumeNext = vi.fn(async () =>
    options.consumeStatus === 'generation_changed'
      ? { status: 'generation_changed' as const }
      : {
          status: options.consumeStatus ?? ('accepted' as const),
          consumedSequence: 7,
          terminalAnalysisSequence: 6,
        },
  )
  const dependencies = {
    authorization: {
      readMerchantAuthorization: vi.fn(async () =>
        options.authorization === 'absent'
          ? null
          : {
              organizationId: ORGANIZATION_ID,
              propertyId: PROPERTY_ID,
              state: 'enabled' as const,
              stateVersion: 1,
              authorizationLineageId: LINEAGE_ID,
              authorizedSourceEpoch: 2,
              capabilities: ['review_analysis'] as const,
              capabilityRuntimeProfileVersions: {
                review_analysis: 'review-analysis-runtime-v1',
              },
              capabilityEpochs: {
                review_analysis: { epoch: 1, changedAtEpochMillis: NOW },
                reply_drafting: { epoch: 1, changedAtEpochMillis: NOW },
                property_trends: { epoch: 1, changedAtEpochMillis: NOW },
              },
              reviewAnalysisStartSequence: 1,
              noticeVersion: MERCHANT_AI_NOTICE_VERSION,
              noticeDigest: SHA,
              sourcePolicyId: 'google-business-profile-source-policy-v1',
              sourceCanonicalizerDigest: SHA,
              redactionProfileFamily: 'gbp-review-global-v1',
              providerDeploymentProfileVersion: 'private-beta-global-v1',
            },
      ),
    },
    control: {
      readHeads: vi.fn(async () => [
        {
          scope: { kind: 'global' as const },
          controlId: '71000000-0000-4000-8000-000000000111',
          generation: 1,
          executionState: 'enabled' as const,
          admissionState: 'accepting' as const,
          updatedAtEpochMillis: NOW,
        },
        {
          scope: {
            kind: 'provider_deployment_profile' as const,
            providerDeploymentProfileVersion: 'private-beta-global-v1',
          },
          controlId: '71000000-0000-4000-8000-000000000112',
          generation: 1,
          executionState: 'enabled' as const,
          admissionState: 'accepting' as const,
          updatedAtEpochMillis: NOW,
        },
        {
          scope: { kind: 'capability' as const, capability: 'review_analysis' as const },
          controlId: '71000000-0000-4000-8000-000000000113',
          generation: 1,
          executionState: 'enabled' as const,
          admissionState: 'accepting' as const,
          updatedAtEpochMillis: NOW,
        },
      ]),
      transition: vi.fn(),
    },
    inference: {
      analyzeReview,
      generateReply: vi.fn(),
      generateTrend: vi.fn(),
    },
    operations: {
      claim,
      claimExecution,
      recordFailure,
      markDelivered,
    },
    outputs: {
      storeAnalysis,
      settleEphemeralReply: vi.fn(),
      findCurrentReviewIdsByAttention: vi.fn(),
      storeTrendReport: vi.fn(),
      readAnalysisForDelivery: vi.fn(),
      readTrendReportForDelivery: vi.fn(),
    },
    aggregates: {
      applyReviewAnalysis,
      advanceWithoutAnalysis,
      readWindow: vi.fn(),
    },
    quota: {
      acquire: vi.fn(async () =>
        options.quotaCode === undefined
          ? { ok: true as const, quotaId: 'quota-1' }
          : { ok: false as const, code: options.quotaCode },
      ),
      release,
    },
    reviewEvents: {
      consumeNext,
      settleOutcome,
    },
    reviewSources: {
      readForAi: readReviewSource,
      readReplyStateRevision: vi.fn(),
      assertCurrent: vi.fn(),
    },
    processingProfiles: {
      readForAi: readProcessingProfile,
      refreshForAi: vi.fn(),
    },
    subjectHmac: {
      sign: vi.fn(() => ({ digest: SHA, keyVersion: 'ai-subject-hmac-v1' })),
    },
    nowEpochMillis: () => NOW,
  } as unknown as AnalyzeReviewEventDependencies

  return {
    analyze: createAnalyzeReviewEvent(dependencies),
    mocks: {
      analyzeReview,
      storeAnalysis,
      settleOutcome,
      recordFailure,
      applyReviewAnalysis,
      advanceWithoutAnalysis,
      markDelivered,
      release,
      readReviewSource,
      readProcessingProfile,
      consumeNext,
    },
  }
}

describe('review-analysis-v2 local primary category', () => {
  it('selects the aspect with the largest absolute intensity', () => {
    expect(
      derivePrimaryCategoryV1([
        { aspect: 'service', polarity: 'positive', intensity: 40 },
        { aspect: 'room', polarity: 'negative', intensity: -80 },
        { aspect: 'noise', polarity: 'negative', intensity: -60 },
      ]),
    ).toBe('room')
  })

  it('lets a negative aspect win an equal-magnitude tie', () => {
    expect(
      derivePrimaryCategoryV1([
        { aspect: 'service', polarity: 'positive', intensity: 80 },
        { aspect: 'cleanliness', polarity: 'negative', intensity: -80 },
      ]),
    ).toBe('cleanliness')
  })

  it('falls back to other when no aspect is available', () => {
    expect(derivePrimaryCategoryV1([])).toBe('other')
  })
})

describe('analyze review event', () => {
  describe('with the pinned language runtime', () => {
    beforeEach(withPinnedLanguageRuntime)

    it('receipts a duplicate event without reading runtime state or invoking the provider', async () => {
      const harness = createHarness({ consumeStatus: 'duplicate' })

      await expect(harness.analyze(input)).resolves.toEqual({ status: 'replayed' })
      expect(harness.mocks.readProcessingProfile).not.toHaveBeenCalled()
      expect(harness.mocks.readReviewSource).not.toHaveBeenCalled()
      expect(harness.mocks.analyzeReview).not.toHaveBeenCalled()
      expect(harness.mocks.storeAnalysis).not.toHaveBeenCalled()
      expect(harness.mocks.settleOutcome).not.toHaveBeenCalled()
      expect(harness.mocks.advanceWithoutAnalysis).not.toHaveBeenCalled()
      expect(harness.mocks.applyReviewAnalysis).not.toHaveBeenCalled()
    })

    it('fails unsupported languages closed without invoking the provider', async () => {
      const harness = createHarness({ languageCode: 'sw-Latn' })

      await expect(harness.analyze(input)).resolves.toEqual({ status: 'terminal' })
      expect(harness.mocks.analyzeReview).not.toHaveBeenCalled()
      expect(harness.mocks.storeAnalysis).not.toHaveBeenCalled()
      expect(harness.mocks.settleOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'terminal_no_result',
          dispositionCode: 'language_not_supported',
        }),
      )
      expect(harness.mocks.advanceWithoutAnalysis).toHaveBeenCalledOnce()
    })

    it('stores, aggregates, and delivers one successful analysis', async () => {
      const harness = createHarness()

      await expect(harness.analyze(input)).resolves.toEqual({ status: 'completed' })
      expect(harness.mocks.storeAnalysis).toHaveBeenCalledWith(
        expect.objectContaining({
          result: {
            status: 'ready',
            derivative: {
              sentiment: 'negative',
              primaryCategory: 'service',
              attention: 'urgent',
              aspects: [{ aspect: 'service', polarity: 'negative', intensity: -90 }],
              issueLabel: 'service recovery',
            },
          },
        }),
      )
      expect(harness.mocks.applyReviewAnalysis).toHaveBeenCalledOnce()
      expect(harness.mocks.markDelivered).toHaveBeenCalledOnce()
      expect(harness.mocks.release).toHaveBeenCalledWith({ quotaId: 'quota-1' })
    })

    it.each([
      [
        'urgent',
        {
          sentiment: 'positive',
          sentimentValence: 60,
          urgencySignals: ['safety'],
          aspects: [{ aspect: 'service', polarity: 'positive', intensity: 60 }],
          issueLabel: null,
        },
        5,
        'urgent',
      ],
      [
        'high',
        {
          sentiment: 'positive',
          sentimentValence: 60,
          urgencySignals: ['service_failure'],
          aspects: [{ aspect: 'service', polarity: 'positive', intensity: 60 }],
          issueLabel: null,
        },
        5,
        'high',
      ],
      [
        'medium',
        {
          sentiment: 'negative',
          sentimentValence: -40,
          urgencySignals: [],
          aspects: [{ aspect: 'service', polarity: 'negative', intensity: -40 }],
          issueLabel: null,
        },
        5,
        'medium',
      ],
      [
        'low',
        {
          sentiment: 'positive',
          sentimentValence: 60,
          urgencySignals: [],
          aspects: [{ aspect: 'service', polarity: 'positive', intensity: 60 }],
          issueLabel: null,
        },
        5,
        'low',
      ],
    ] as const)(
      'keeps review-attention-v1 %s behavior pinned',
      async (_case, analysisResult, rating, expectedAttention) => {
        const harness = createHarness({ analysisResult, rating })

        await expect(harness.analyze(input)).resolves.toEqual({ status: 'completed' })
        expect(harness.mocks.storeAnalysis).toHaveBeenCalledWith(
          expect.objectContaining({
            result: expect.objectContaining({
              derivative: expect.objectContaining({ attention: expectedAttention }),
            }),
          }),
        )
      },
    )

    it.each([
      ['uppercase', 'Bed bugs'],
      ['digits', 'room 2'],
      ['punctuation', 'bed-bugs'],
      ['five words', 'one two three four five'],
      ['41 characters', 'a'.repeat(41)],
      ['review excerpt with a proper noun', 'dirty sheets at Hilton'],
    ])(
      'rejects %s issue labels as output_invalid without storage',
      async (_case, issueLabel) => {
        const harness = createHarness({
          analysisResult: {
            ...VALID_ANALYSIS_RESULT,
            issueLabel,
          },
        })

        await expect(harness.analyze(input)).resolves.toEqual({
          status: 'retry',
          retryAtEpochMillis: NOW + 1_000,
          code: 'output_invalid',
        })
        expect(harness.mocks.recordFailure).toHaveBeenCalledWith(
          expect.objectContaining({ failureCode: 'output_invalid' }),
        )
        expect(harness.mocks.storeAnalysis).not.toHaveBeenCalled()
        expect(harness.mocks.applyReviewAnalysis).not.toHaveBeenCalled()
      },
    )

    it('finishes an idempotent aggregate replay when its outcome is already terminal', async () => {
      const harness = createHarness({
        operationState: 'succeeded_pending_delivery',
        settleOutcome: false,
      })

      await expect(harness.analyze(input)).resolves.toEqual({
        status: 'replayed',
      })
      expect(harness.mocks.analyzeReview).not.toHaveBeenCalled()
      expect(harness.mocks.applyReviewAnalysis).toHaveBeenCalledOnce()
      expect(harness.mocks.markDelivered).toHaveBeenCalledOnce()
    })

    it('does not mark a replay delivered when aggregate generations are stale', async () => {
      const harness = createHarness({
        operationState: 'succeeded_pending_delivery',
        aggregateStatus: 'stale',
      })

      await expect(harness.analyze(input)).resolves.toEqual({
        status: 'generation_changed',
      })
      expect(harness.mocks.applyReviewAnalysis).toHaveBeenCalledOnce()
      expect(harness.mocks.markDelivered).not.toHaveBeenCalled()
    })

    it('defers a quota denial instead of terminal-settling the outcome', async () => {
      const harness = createHarness({ quotaCode: 'quota_exhausted' })

      await expect(harness.analyze(input)).resolves.toEqual({
        status: 'retry',
        retryAtEpochMillis: NOW + 30_000,
        code: 'quota_exhausted',
      })
      expect(harness.mocks.analyzeReview).not.toHaveBeenCalled()
      expect(harness.mocks.settleOutcome).not.toHaveBeenCalled()
      expect(harness.mocks.advanceWithoutAnalysis).not.toHaveBeenCalled()
    })

    it('keeps deferring a quota denial while the operation is inside its own horizon', async () => {
      // A relay backlog must not cut short work that has already been claimed:
      // once an operation exists it gets the full horizon from its own createdAt.
      const harness = createHarness({ quotaCode: 'quota_exhausted' })

      await expect(harness.analyze(elapsedInput)).resolves.toMatchObject({
        status: 'retry',
        code: 'quota_exhausted',
      })
      expect(harness.mocks.settleOutcome).not.toHaveBeenCalled()
    })

    it('terminal-settles a quota denial once the operation horizon has elapsed', async () => {
      const harness = createHarness({
        quotaCode: 'quota_exhausted',
        operationCreatedAtEpochMillis: NOW - AI_ANALYSIS_OPERATION_HORIZON_MILLIS,
      })

      await expect(harness.analyze(elapsedInput)).resolves.toEqual({
        status: 'terminal',
      })
      expect(harness.mocks.analyzeReview).not.toHaveBeenCalled()
      expect(harness.mocks.settleOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'terminal_no_result',
          dispositionCode: 'policy_disabled',
        }),
      )
      expect(harness.mocks.advanceWithoutAnalysis).toHaveBeenCalledOnce()
    })

    it('keeps deferring a quota denial for a backfill long after the live horizon', async () => {
      const harness = createHarness({
        quotaCode: 'quota_exhausted',
        operationCreatedAtEpochMillis: NOW - AI_ANALYSIS_OPERATION_HORIZON_MILLIS,
      })

      await expect(harness.analyze(agedBackfillInput)).resolves.toMatchObject({
        status: 'retry',
        code: 'quota_exhausted',
      })
      expect(harness.mocks.settleOutcome).not.toHaveBeenCalled()
    })

    describe('provider capacity', () => {
      // A rate limit describes the provider, not the review. A batch backfill
      // under a per-minute token cap saw every fourth answer arrive within
      // seconds and settled half of a property's history as never analysable.
      it('retries a rate limit at the provider retry-after even on the last budgeted attempt', async () => {
        const harness = createHarness({
          operationExecutionAttempt: 3,
          operationFailureCode: 'provider_rate_limited',
          providerError: {
            code: 'provider_rate_limited',
            retryAfterEpochMillis: NOW + 20_000,
          },
        })

        await expect(harness.analyze(input)).resolves.toEqual({
          status: 'retry',
          retryAtEpochMillis: NOW + 20_000,
          code: 'provider_rate_limited',
        })
        expect(harness.mocks.recordFailure).toHaveBeenCalledWith(
          expect.objectContaining({
            failureCode: 'provider_rate_limited',
            retryAtEpochMillis: NOW + 20_000,
          }),
        )
        expect(harness.mocks.settleOutcome).not.toHaveBeenCalled()
      })

      it('keeps asking the provider past the budget while its last answer was capacity', async () => {
        const harness = createHarness({
          operationExecutionAttempt: 6,
          operationFailureCode: 'provider_unavailable',
        })

        await expect(harness.analyze(input)).resolves.toEqual({ status: 'completed' })
        expect(harness.mocks.analyzeReview).toHaveBeenCalledOnce()
      })

      it('still terminal-settles a review the provider itself failed four times', async () => {
        const harness = createHarness({
          operationExecutionAttempt: 4,
          operationFailureCode: 'output_invalid',
        })

        await expect(harness.analyze(input)).resolves.toEqual({ status: 'terminal' })
        expect(harness.mocks.analyzeReview).not.toHaveBeenCalled()
        expect(harness.mocks.advanceWithoutAnalysis).toHaveBeenCalledOnce()
      })

      it('terminal-settles a refusal on the last budgeted attempt', async () => {
        const harness = createHarness({
          operationExecutionAttempt: 3,
          providerError: { code: 'provider_refused', retryAfterEpochMillis: null },
        })

        await expect(harness.analyze(input)).resolves.toEqual({ status: 'terminal' })
        expect(harness.mocks.recordFailure).toHaveBeenCalledWith(
          expect.objectContaining({
            failureCode: 'provider_refused',
            retryAtEpochMillis: null,
          }),
        )
        expect(harness.mocks.advanceWithoutAnalysis).toHaveBeenCalledOnce()
      })
    })
  })

  describe('with a drifted language runtime', () => {
    beforeEach(withDriftedLanguageRuntime)

    it('retries instead of destroying the analysis', async () => {
      const harness = createHarness()

      await expect(harness.analyze(input)).resolves.toEqual({
        status: 'retry',
        retryAtEpochMillis: NOW + 30_000,
        code: 'language_runtime_unavailable',
      })
      expect(harness.mocks.analyzeReview).not.toHaveBeenCalled()
      expect(harness.mocks.settleOutcome).not.toHaveBeenCalled()
      expect(harness.mocks.advanceWithoutAnalysis).not.toHaveBeenCalled()
    })

    it('terminal-settles only once the operation horizon has elapsed', async () => {
      const harness = createHarness()

      await expect(harness.analyze(elapsedInput)).resolves.toEqual({
        status: 'terminal',
      })
      expect(harness.mocks.settleOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'terminal_no_result',
          dispositionCode: 'policy_disabled',
        }),
      )
      expect(harness.mocks.advanceWithoutAnalysis).toHaveBeenCalledOnce()
    })
  })

  describe('with an unavailable property processing profile', () => {
    it.each(['not_found', 'policy_unavailable'] as const)(
      'retries a %s profile instead of terminal-skipping the review',
      async (profileStatus) => {
        const harness = createHarness({ profileStatus })

        await expect(harness.analyze(input)).resolves.toEqual({
          status: 'retry',
          retryAtEpochMillis: NOW + 30_000,
          code: `property_profile_${profileStatus}`,
        })
        expect(harness.mocks.settleOutcome).not.toHaveBeenCalled()
        expect(harness.mocks.advanceWithoutAnalysis).not.toHaveBeenCalled()
      },
    )

    it('terminal-settles a deleting owner immediately', async () => {
      const harness = createHarness({ profileStatus: 'deleting' })

      await expect(harness.analyze(input)).resolves.toEqual({ status: 'terminal' })
      expect(harness.mocks.settleOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'terminal_no_result',
          dispositionCode: 'policy_disabled',
        }),
      )
    })

    it('terminal-settles a missing profile once the operation horizon has elapsed', async () => {
      const harness = createHarness({ profileStatus: 'not_found' })

      await expect(harness.analyze(elapsedInput)).resolves.toEqual({
        status: 'terminal',
      })
      expect(harness.mocks.advanceWithoutAnalysis).toHaveBeenCalledOnce()
    })

    it('still terminal-settles a source lifecycle transition with no profile', async () => {
      const harness = createHarness({ profileStatus: 'not_found' })

      await expect(
        harness.analyze({ ...input, disposition: 'provider_deleted' }),
      ).resolves.toEqual({ status: 'terminal' })
      expect(harness.mocks.settleOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'terminal_no_result',
          dispositionCode: 'provider_deleted',
        }),
      )
      expect(harness.mocks.advanceWithoutAnalysis).toHaveBeenCalledOnce()
    })
  })

  describe('before the property has ever enabled AI', () => {
    // The first enable creates the lineage at epoch 1 with its watermark at
    // the allocator head; everything allocated before it sits below that
    // watermark and is re-allocated by the enrollment backfill. A derivative
    // written under an invented epoch 1 would count against that lineage's
    // coverage and break the exact-count invariant the moment AI is enabled.
    it.each(['pending', 'provider_deleted'] as const)(
      'acknowledges a %s review event without writing a derivative',
      async (disposition) => {
        const harness = createHarness({ authorization: 'absent' })

        await expect(harness.analyze({ ...input, disposition })).resolves.toEqual({
          status: 'replayed',
        })
        expect(harness.mocks.consumeNext).not.toHaveBeenCalled()
        expect(harness.mocks.settleOutcome).not.toHaveBeenCalled()
        expect(harness.mocks.advanceWithoutAnalysis).not.toHaveBeenCalled()
        expect(harness.mocks.analyzeReview).not.toHaveBeenCalled()
      },
    )
  })
})
