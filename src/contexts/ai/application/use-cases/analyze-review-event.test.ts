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
  createAnalyzeReviewEvent,
} from './analyze-review-event'
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
})
/** The same event, redelivered after its bounded operation horizon elapsed. */
const elapsedInput = Object.freeze({
  ...input,
  eventRecordedAtEpochMillis: NOW - AI_ANALYSIS_OPERATION_HORIZON_MILLIS,
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
        options.operationState === 'succeeded_pending_delivery' ||
        options.operationState === 'succeeded'
          ? 1
          : 0,
      executionPermitId:
        options.operationState === 'succeeded_pending_delivery' ||
        options.operationState === 'succeeded'
          ? PERMIT_ID
          : null,
      nextAttemptAtEpochMillis: null,
      failureCode: null,
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
      executionAttempt: 1,
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
  const analyzeReview = vi.fn(async () => ({
    route: 'review-analysis' as const,
    status: 'success' as const,
    result: {
      sentiment: 'negative' as const,
      sentimentValence: -90,
      primaryCategory: 'service' as const,
      urgencySignals: ['health'] as const,
    },
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
  }))
  const release = vi.fn(async () => {})

  const dependencies = {
    authorization: {
      readMerchantAuthorization: vi.fn(async () => ({
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
      })),
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
      read: vi.fn(),
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
      consumeNext: vi.fn(async () => ({
        status: 'accepted' as const,
        consumedSequence: 7,
        terminalAnalysisSequence: 6,
      })),
      settleOutcome,
    },
    reviewSources: {
      readForAi: vi.fn(async () => ({
        status: 'available' as const,
        observation: {
          kind: 'review' as const,
          reviewId: REVIEW_ID,
          organizationId: ORGANIZATION_ID,
          propertyId: PROPERTY_ID,
          text: 'The kitchen made several guests sick.',
          rating: 1 as const,
          languageCode:
            options.languageCode === undefined ? 'en-US' : options.languageCode,
          reviewedAtEpochMillis: NOW - 1_000,
          contentExpiresAtEpochMillis: NOW + 60_000,
          sourceEpoch: 2,
          sourceRevision: 5,
          analysisSequence: 7,
        },
      })),
      readReplyStateRevision: vi.fn(),
      assertCurrent: vi.fn(),
    },
    processingProfiles: {
      readForAi: vi.fn(async () =>
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
      ),
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
      applyReviewAnalysis,
      advanceWithoutAnalysis,
      markDelivered,
      release,
    },
  }
}

describe('analyze review event', () => {
  describe('with the pinned language runtime', () => {
    beforeEach(withPinnedLanguageRuntime)

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
            },
          },
        }),
      )
      expect(harness.mocks.applyReviewAnalysis).toHaveBeenCalledOnce()
      expect(harness.mocks.markDelivered).toHaveBeenCalledOnce()
      expect(harness.mocks.release).toHaveBeenCalledWith({ quotaId: 'quota-1' })
    })

    it('does not aggregate or mark delivery when replay settlement loses authorization', async () => {
      const harness = createHarness({
        operationState: 'succeeded_pending_delivery',
        settleOutcome: false,
      })

      await expect(harness.analyze(input)).resolves.toEqual({
        status: 'generation_changed',
      })
      expect(harness.mocks.analyzeReview).not.toHaveBeenCalled()
      expect(harness.mocks.applyReviewAnalysis).not.toHaveBeenCalled()
      expect(harness.mocks.markDelivered).not.toHaveBeenCalled()
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
})
