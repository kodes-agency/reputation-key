import type { ReviewAnalysisSourceInput } from '#/contexts/ai/application/ports/ai-inference.port'
import type { AiOperationRecord } from '#/contexts/ai/application/ports/ai-operation-store.port'
import type { AnalyzeReviewEventDependencies } from '#/contexts/ai/application/use-cases/analyze-review-event'
import {
  AI_ANALYSIS_OPERATION_HORIZON_MILLIS,
  AI_BACKFILL_OPERATION_HORIZON_MILLIS,
  createAnalyzeReviewEvent,
} from '#/contexts/ai/application/use-cases/analyze-review-event'
import type { AiErrorCode } from '#/contexts/ai/domain/errors'
import type { AiOperationId, AiPropertyProfileResult } from '#/contexts/ai/domain/types'
import {
  createAiHandlerHarness,
  useAiHandlerDatabase,
} from '#/contexts/ai/infrastructure/testing/handler-harness.test-fixtures'
import {
  AI_REVIEW_LANGUAGE_ICU_VERSION,
  AI_REVIEW_LANGUAGE_UNICODE_VERSION,
} from '#/shared/ai-review-language-catalogue'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { AI_REVIEW_LANGUAGE_REGION_NODE_VERSION } from '#/shared/generated/ai-review-language-canonical-regions-v1'
import { afterEach, vi } from 'vitest'
const handlerDatabase = useAiHandlerDatabase()

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

type ControlStop =
  | Readonly<{
      kind: 'global' | 'provider_deployment_profile' | 'capability'
      executionState: 'enabled' | 'killed'
      admissionState: 'accepting' | 'draining'
    }>
  | 'missing_provider'

const CONTROL_STOPS = {
  'the capability is killed': {
    kind: 'capability',
    executionState: 'killed',
    admissionState: 'accepting',
  },
  'the global control is draining': {
    kind: 'global',
    executionState: 'enabled',
    admissionState: 'draining',
  },
  'the provider control is killed': {
    kind: 'provider_deployment_profile',
    executionState: 'killed',
    admissionState: 'accepting',
  },
  'a control head is missing': 'missing_provider',
} as const satisfies Readonly<Record<string, ControlStop>>

async function createHarness(
  options: Readonly<{
    languageCode?: string | null
    operationState?: AiOperationRecord['state']
    aggregateStatus?: 'applied' | 'stale' | 'unavailable'
    profileStatus?: Exclude<AiPropertyProfileResult['status'], 'available'>
    admissionCode?: 'admission_busy' | 'admission_unavailable'
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
    /** The AI execution control heads. Defaults to all three open. */
    controlStop?: ControlStop
    /** The merchant's AI authorization state. Defaults to enabled. */
    authorizationState?: 'enabled' | 'disabled'
    /** The notice the Property's consent was recorded under. Defaults to the served one. */
    consentNotice?: Readonly<{ noticeVersion: string; noticeDigest: string }>
  }> = {},
) {
  const persistence = await createAiHandlerHarness(handlerDatabase(), {
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    operationId: OPERATION_ID,
    permitId: PERMIT_ID,
    lineageId: LINEAGE_ID,
    now: NOW,
    capability: 'review_analysis',
    consentNotice:
      options.consentNotice?.noticeDigest === SHA ? undefined : options.consentNotice,
    authorization: options.authorization,
  })
  // Inconsistent notice digests cannot be stored. Keep this defensive port
  // contract check distinct from the persisted consent scenarios.
  if (options.consentNotice?.noticeDigest === SHA) {
    const authorization = await persistence.readAuthorization()
    persistence.authorization.readMerchantAuthorization.mockResolvedValue({
      ...authorization!,
      ...options.consentNotice,
    })
  }
  const { claim, claimExecution, recordFailure, markDelivered } = persistence.operations
  if (options.authorizationState === 'disabled')
    await persistence.grant({ state: 'disabled' })
  if (options.controlStop === 'missing_provider') {
    persistence.control.readHeads.mockImplementation((request) =>
      persistence.controlAdapter.readHeads({
        ...request,
        providerDeploymentProfileVersion: 'unconfigured-profile',
      }),
    )
  } else if (options.controlStop) {
    const stop = options.controlStop
    await persistence.transition(stop.executionState, stop.admissionState, stop.kind)
  }
  if (
    options.operationState ||
    options.operationExecutionAttempt ||
    options.operationCreatedAtEpochMillis ||
    options.operationFailureCode
  ) {
    persistence.seedClaim({
      state: options.operationState ?? 'pending',
      executionAttempt:
        options.operationExecutionAttempt ??
        (options.operationState?.startsWith('succeeded') ? 1 : 0),
      executionPermitId: options.operationState?.startsWith('succeeded')
        ? PERMIT_ID
        : null,
      failureCode: options.operationFailureCode ?? null,
      ...(options.operationCreatedAtEpochMillis === undefined
        ? {}
        : { createdAt: new Date(options.operationCreatedAtEpochMillis) }),
    })
  }
  const storeAnalysis = vi.fn(async () => {
    await persistence.patchOperation({ state: 'succeeded_pending_delivery' })
    return true
  })
  const applyReviewAnalysis = vi.fn(async () => {
    const status = options.aggregateStatus ?? 'applied'
    if (status === 'applied') return { status, aggregateRevision: 4 } as const
    return { status } as const
  })
  const advanceWithoutAnalysis = vi.fn(async () => ({
    status: 'applied' as const,
    aggregateRevision: 4,
  }))
  const analyzeReview = vi.fn(async (request: ReviewAnalysisSourceInput) => {
    const admission = await persistence.settleProviderOperation(request.operationId)
    if (!admission.ok) throw new Error('synthetic provider budget refused')
    return options.providerError
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

            grantKid: 'grant_v1',
            operationId: request.operationId,
            permitId: request.permitId,
            attemptNumber: request.attemptNumber,
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
          },
        }
  })
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

  const readHeads = persistence.control.readHeads
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
    authorization: persistence.authorization,
    control: persistence.control,
    inference: {
      analyzeReview,
      generateReply: vi.fn(),
      generateTrend: vi.fn(),
    },
    operations: persistence.operations,
    outputs: {
      storeAnalysis,
      settleEphemeralReply: vi.fn(),
      findCurrentReviewIdsByAttention: vi.fn(),
      readAnalysisForDelivery: vi.fn(),
    },
    aggregates: {
      applyReviewAnalysis,
      advanceWithoutAnalysis,
      readWindow: vi.fn(),
    },
    admission: {
      acquire: vi.fn(async () =>
        options.admissionCode === undefined
          ? {
              ok: true as const,
              admissionId: 'admission-1',
              expiresAtEpochMillis: NOW + 90_000,
            }
          : options.admissionCode === 'admission_busy'
            ? {
                ok: false as const,
                code: 'admission_busy' as const,
                retryAfterEpochMillis: NOW + 15_000,
              }
            : { ok: false as const, code: 'admission_unavailable' as const },
      ),
      release,
    },
    reviewEvents: {
      consumeNext,
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
    persistence,
    analyze: createAnalyzeReviewEvent(dependencies),
    mocks: {
      analyzeReview,
      storeAnalysis,
      recordFailure,
      applyReviewAnalysis,
      advanceWithoutAnalysis,
      markDelivered,
      release,
      readReviewSource,
      readProcessingProfile,
      consumeNext,
      claim,
      claimExecution,
      acquire: dependencies.admission.acquire,
      readHeads,
    },
  }
}

export {
  agedBackfillInput,
  CONTROL_STOPS,
  createHarness,
  elapsedInput,
  input,
  LINEAGE_ID,
  NOW,
  OPERATION_ID,
  ORGANIZATION_ID,
  PROPERTY_ID,
  REVIEW_ID,
  SHA,
  VALID_ANALYSIS_RESULT,
  withDriftedLanguageRuntime,
  withPinnedLanguageRuntime,
}
