// The review analysis use case under the v3 contract, the one the live runtime
// catalogue selects since the switch-on (2026-10-30). The skeleton is the one
// analyze-review-event.test.ts covers for the retired v2 contract; this file shows
// what the v3 contract does differently. Everything here is invented: no review text
// of a real guest, no provider, no database.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import {
  AI_REVIEW_LANGUAGE_ICU_VERSION,
  AI_REVIEW_LANGUAGE_UNICODE_VERSION,
} from '#/shared/ai-review-language-catalogue'
import { AI_REVIEW_LANGUAGE_REGION_NODE_VERSION } from '#/shared/generated/ai-review-language-canonical-regions-v1'
import {
  REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
  REVIEW_ANALYSIS_NORMALIZATION_VERSION,
} from '#/shared/review-analysis-v3-normalizer'
import { parseAiGatewayRouteRequest } from '#/shared/ai-gateway-transport-contract'
import { resolveReviewPropertyContext } from '#/shared/review-vocabulary-hints'
import type { AiOperationId } from '../../domain/types'
import type {
  AiOperationRecord,
  AiOperationStorePort,
} from '../ports/ai-operation-store.port'
import type { AiProviderChoicePort } from '../ports/ai-provider-choice.port'
import { createReviewAnalysisContractV3 } from '../review-analysis-contract-v3'
import {
  AI_ANALYSIS_OPERATION_HORIZON_MILLIS,
  createAnalyzeReviewEvent,
  type AnalyzeReviewEventDependencies,
} from './analyze-review-event'

const ACTUAL_VERSIONS = process.versions
beforeEach(() => {
  Object.defineProperty(process, 'versions', {
    value: {
      ...process.versions,
      node: AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
      icu: AI_REVIEW_LANGUAGE_ICU_VERSION,
      unicode: AI_REVIEW_LANGUAGE_UNICODE_VERSION.replace(/\.0$/u, ''),
    },
    configurable: true,
    writable: false,
    enumerable: true,
  })
})
afterEach(() => {
  Object.defineProperty(process, 'versions', {
    value: ACTUAL_VERSIONS,
    configurable: true,
    writable: false,
    enumerable: true,
  })
})

const NOW = Date.parse('2026-10-20T12:00:00.000Z')
const ORGANIZATION_ID = organizationId('ai-analysis-v3-workflow-test')
const PROPERTY_ID = propertyId('72000000-0000-4000-8000-000000000101')
const REVIEW_ID = reviewId('72000000-0000-4000-8000-000000000102')
const OPERATION_ID = '72000000-0000-4000-8000-000000000103' as AiOperationId
const PERMIT_ID = '72000000-0000-4000-8000-000000000104'
const LINEAGE_ID = '72000000-0000-4000-8000-000000000105'
const SHA = 'a'.repeat(64)

const input = Object.freeze({
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  reviewId: REVIEW_ID,
  sourceEpoch: 2,
  sourceRevision: 5,
  analysisSequence: 7,
  eventEnvelopeId: '72000000-0000-4000-8000-000000000106',
  disposition: 'pending' as const,
  eventRecordedAtEpochMillis: NOW,
  operationHorizonMillis: AI_ANALYSIS_OPERATION_HORIZON_MILLIS,
})

const PROVIDER_LINEAGE = Object.freeze({
  providerId: 'openai' as const,
  model: 'synthetic-model-2026-10-01',
  requestProfileVersion: 'synthetic-request-profile-v1',
  requestProfileDigest: '1'.repeat(64),
})

const SENTENCES = Object.freeze([
  Object.freeze({ number: 1, text: 'The room was lovely.' }),
  Object.freeze({ number: 2, text: 'Check-in took an hour.' }),
  Object.freeze({ number: 3, text: 'Nobody answered the phone!' }),
])

function gatewayAnswer(
  answer: Readonly<{
    sentiment: 'positive' | 'neutral' | 'negative' | 'mixed'
    mentions: readonly Readonly<Record<string, unknown>>[]
    urgent: Readonly<{ reason: string }> | null
  }>,
  flags: readonly string[] = [],
) {
  return {
    contract: 'review-analysis-v3' as const,
    answer,
    normalization: {
      version: REVIEW_ANALYSIS_NORMALIZATION_VERSION,
      digest: REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
      flags,
      droppedMentionCount: 0,
    },
  }
}

const SLOW_CHECK_IN = Object.freeze({
  topic: 'speed_waiting',
  polarity: 'negative',
  strength: 'clear',
  thing: 'check-in',
  issue: 'slow',
  sentences: [2],
  names_person: null,
})

const LOVELY_ROOM = Object.freeze({
  topic: 'facilities_equipment',
  polarity: 'positive',
  strength: 'mild',
  thing: 'room',
  issue: 'lovely',
  sentences: [1],
  names_person: null,
})

function harness(
  options: Readonly<{
    result?: unknown
    rating?: 1 | 2 | 3 | 4 | 5
    sentences?: typeof SENTENCES | undefined
    runtimeProfile?: string
    providerDeployment?: string
    /** The notice the Property's consent was recorded under. Defaults to the served one. */
    consentNotice?: Readonly<{ noticeVersion: string; noticeDigest: string }>
    choice?: Awaited<ReturnType<AiProviderChoicePort['chooseForReviewAnalysis']>>
    stored?: boolean
    category?: string | null
  }> = {},
) {
  let claimed: AiOperationRecord | undefined
  const claim = vi.fn<AiOperationStorePort['claim']>(async (request) => {
    claimed = {
      id: OPERATION_ID,
      identity: request.identity,
      binding: request.binding,
      idempotencyKey: request.idempotencyKey,
      requestFingerprint: request.requestFingerprint,
      sourceProvenance: null,
      state: 'pending',
      executionAttempt: 0,
      executionPermitId: null,
      nextAttemptAtEpochMillis: null,
      failureCode: null,
      createdAtEpochMillis: request.nowEpochMillis,
      updatedAtEpochMillis: request.nowEpochMillis,
      expiresAtEpochMillis: request.expiresAtEpochMillis,
    }
    return { status: 'created', operation: claimed }
  })
  const claimExecution = vi.fn<AiOperationStorePort['claimExecution']>(async () => {
    if (!claimed) return null
    claimed = {
      ...claimed,
      state: 'executing',
      executionAttempt: claimed.executionAttempt + 1,
      executionPermitId: PERMIT_ID,
    }
    return claimed
  })
  const recordFailure = vi.fn<AiOperationStorePort['recordFailure']>(async () => true)
  const markDelivered = vi.fn<AiOperationStorePort['markDelivered']>(async () => true)
  const storeAnalysisV3 = vi.fn(async (_request: unknown) => options.stored !== false)
  const storeAnalysis = vi.fn(async () => true)
  const settleOutcome = vi.fn(async () => ({
    terminalAnalysisSequence: 7,
    aggregateRevision: 4,
  }))
  const applyReviewAnalysis = vi.fn(async () => ({
    status: 'applied' as const,
    aggregateRevision: 4,
  }))
  const advanceWithoutAnalysis = vi.fn(async () => ({
    status: 'applied' as const,
    aggregateRevision: 4,
  }))
  // The live gateway serves a v3 binding (`parseAiGatewayRouteRequest` accepts the
  // request the use case builds: a test below parses it), so the mock reads what
  // the use case put in the request and answers.
  const analyzeReview = vi.fn(async (_request: unknown) => {
    return {
      route: 'review-analysis' as const,
      status: 'success' as const,
      result:
        options.result ??
        gatewayAnswer({ sentiment: 'mixed', mentions: [SLOW_CHECK_IN], urgent: null }),
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
        inputTokens: 300,
        cachedInputTokens: 0,
        outputTokens: 80,
        reasoningTokens: 0,
        costMicros: 42,
        settledAtEpochMillis: NOW + 1_000,
        settlementState: 'settled' as const,
        receiptSignature: 'A'.repeat(86),
      },
    }
  })
  const readForAi = vi.fn(async (_request: unknown) => ({
    status: 'available' as const,
    observation: {
      kind: 'review' as const,
      reviewId: REVIEW_ID,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      text: 'The room was lovely. Check-in took an hour. Nobody answered the phone!',
      ...(options.sentences === undefined && 'sentences' in options
        ? {}
        : { sentences: options.sentences ?? SENTENCES }),
      rating: options.rating ?? 2,
      languageCode: 'en-US',
      reviewedAtEpochMillis: NOW - 1_000,
      contentExpiresAtEpochMillis: NOW + 60_000,
      sourceEpoch: 2,
      sourceRevision: 5,
      analysisSequence: 7,
    },
  }))
  const chooseForReviewAnalysis = vi.fn(
    async () =>
      options.choice ?? { status: 'chosen' as const, lineage: PROVIDER_LINEAGE },
  )
  const readGooglePrimaryCategory = vi.fn(async () =>
    options.category === undefined ? 'Hotel' : options.category,
  )
  const controlScopes = [
    { kind: 'global' },
    {
      kind: 'provider_deployment_profile',
      providerDeploymentProfileVersion: 'private-beta-global-v2',
    },
    { kind: 'capability', capability: 'review_analysis' },
  ]
  const dependencies = {
    contract: createReviewAnalysisContractV3({
      outputs: { storeAnalysisV3 } as never,
      vocabularyContext: { readGooglePrimaryCategory },
      providerChoice: { chooseForReviewAnalysis },
    }),
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
          review_analysis: options.runtimeProfile ?? 'review-analysis-runtime-v2',
        },
        capabilityEpochs: {
          review_analysis: { epoch: 1, changedAtEpochMillis: NOW },
          reply_drafting: { epoch: 1, changedAtEpochMillis: NOW },
          property_trends: { epoch: 1, changedAtEpochMillis: NOW },
        },
        reviewAnalysisStartSequence: 1,
        noticeVersion: options.consentNotice?.noticeVersion ?? MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: options.consentNotice?.noticeDigest ?? MERCHANT_AI_NOTICE_DIGEST,
        sourcePolicyId: 'google-business-profile-source-policy-v1',
        sourceCanonicalizerDigest: SHA,
        redactionProfileFamily: 'gbp-review-global-v1',
        providerDeploymentProfileVersion:
          options.providerDeployment ?? 'private-beta-global-v2',
      })),
    },
    control: {
      readHeads: vi.fn(async () =>
        controlScopes.map((scope, index) => ({
          scope,
          controlId: `72000000-0000-4000-8000-00000000011${index + 1}`,
          generation: 1,
          executionState: 'enabled' as const,
          admissionState: 'accepting' as const,
          updatedAtEpochMillis: NOW,
        })),
      ),
      transition: vi.fn(),
    },
    inference: { analyzeReview, generateReply: vi.fn(), generateTrend: vi.fn() },
    operations: { claim, claimExecution, recordFailure, markDelivered },
    outputs: { storeAnalysis, storeAnalysisV3 },
    aggregates: { applyReviewAnalysis, advanceWithoutAnalysis, readWindow: vi.fn() },
    admission: {
      acquire: vi.fn(async () => ({
        ok: true as const,
        admissionId: 'admission-1',
        expiresAtEpochMillis: NOW + 90_000,
      })),
      release: vi.fn(async () => {}),
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
      readForAi,
      readReplyStateRevision: vi.fn(),
      assertCurrent: vi.fn(),
    },
    processingProfiles: {
      readForAi: vi.fn(async () => ({
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
      })),
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
      claim,
      analyzeReview,
      storeAnalysis,
      storeAnalysisV3,
      settleOutcome,
      applyReviewAnalysis,
      markDelivered,
      recordFailure,
      readForAi,
      chooseForReviewAnalysis,
      readGooglePrimaryCategory,
    },
  }
}

describe('the review analysis use case under the v3 contract', () => {
  it('sends a request the live gateway transport accepts: the catalogue serves it', async () => {
    const { analyze, mocks } = harness()

    expect(await analyze(input)).toEqual({ status: 'completed' })

    const request = mocks.analyzeReview.mock.calls[0]?.[0]
    expect(() => parseAiGatewayRouteRequest(request)).not.toThrow()
  })

  it('claims the operation under the lineage v3 requires, calls the provider with the evidence request, and stores the derived analysis', async () => {
    const { analyze, mocks } = harness()

    const result = await analyze(input)

    expect(result).toEqual({ status: 'completed' })
    const claim = mocks.claim.mock.calls[0]?.[0]
    expect(claim?.binding).toMatchObject({
      operationProfileVersion: 'review-analysis-v3',
      capabilityRuntimeProfileVersion: 'review-analysis-runtime-v2',
      providerDeploymentProfileVersion: 'private-beta-global-v2',
    })
    expect(claim?.providerLineage).toEqual(PROVIDER_LINEAGE)
    expect(claim?.vocabularyHints).toEqual(
      resolveReviewPropertyContext('Hotel').hintIdentity,
    )
    expect(claim?.normalization).toEqual({
      version: REVIEW_ANALYSIS_NORMALIZATION_VERSION,
      digest: REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
    })
    expect(mocks.readForAi.mock.calls[0]?.[0]).toMatchObject({ sentences: true })
    const request = mocks.analyzeReview.mock.calls[0]?.[0] as Record<string, unknown>
    expect(request).toMatchObject({
      provider: {
        id: 'openai',
        model: PROVIDER_LINEAGE.model,
        requestProfileVersion: PROVIDER_LINEAGE.requestProfileVersion,
        requestProfileDigest: PROVIDER_LINEAGE.requestProfileDigest,
      },
      propertyContext: resolveReviewPropertyContext('Hotel').propertyContext,
      source: { sentences: SENTENCES },
    })
    expect(mocks.storeAnalysis).not.toHaveBeenCalled()
    expect(mocks.storeAnalysisV3).toHaveBeenCalledTimes(1)
    expect(mocks.storeAnalysisV3.mock.calls[0]?.[0]).toMatchObject({
      analysisProfileVersion: 'review-analysis-v3',
      providerCompletion: { modelSnapshot: PROVIDER_LINEAGE.model, inputTokens: 300 },
      derivative: {
        sentiment: 'mixed',
        attention: 'high',
        urgentReason: null,
        mentions: [
          {
            topic: 'speed_waiting',
            polarity: 'negative',
            strength: 'clear',
            thing: 'check-in',
            issue: 'slow',
            sentences: [2],
            namesPerson: null,
          },
        ],
        normalization: { flags: [], droppedMentionCount: 0 },
      },
    })
    expect(mocks.applyReviewAnalysis).toHaveBeenCalledTimes(1)
    expect(mocks.markDelivered).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      name: 'an Urgent reason makes the attention urgent',
      answer: {
        sentiment: 'negative' as const,
        mentions: [{ ...SLOW_CHECK_IN, topic: 'safety', thing: null, issue: null }],
        urgent: { reason: 'safety' },
      },
      rating: 1 as const,
      attention: 'urgent',
      urgentReason: 'safety',
    },
    {
      name: 'a mild complaint alone is medium',
      answer: {
        sentiment: 'mixed' as const,
        mentions: [{ ...SLOW_CHECK_IN, strength: 'mild' }, LOVELY_ROOM],
        urgent: null,
      },
      rating: 4 as const,
      attention: 'medium',
      urgentReason: null,
    },
    {
      name: 'a positive review with no mentions is low',
      answer: { sentiment: 'positive' as const, mentions: [], urgent: null },
      rating: 5 as const,
      attention: 'low',
      urgentReason: null,
    },
  ])('derives the attention with the v2 formula: $name', async (scenario) => {
    const { analyze, mocks } = harness({
      result: gatewayAnswer(scenario.answer),
      rating: scenario.rating,
    })

    expect(await analyze(input)).toEqual({ status: 'completed' })

    expect(mocks.storeAnalysisV3.mock.calls[0]?.[0]).toMatchObject({
      derivative: {
        attention: scenario.attention,
        urgentReason: scenario.urgentReason,
      },
    })
  })

  it('records what the normalizer did on the stored analysis', async () => {
    const { analyze, mocks } = harness({
      result: gatewayAnswer(
        { sentiment: 'negative', mentions: [SLOW_CHECK_IN], urgent: null },
        ['mentions_merged', 'sentence_refs_repaired'],
      ),
    })

    await analyze(input)

    expect(mocks.storeAnalysisV3.mock.calls[0]?.[0]).toMatchObject({
      derivative: {
        normalization: {
          flags: ['mentions_merged', 'sentence_refs_repaired'],
          droppedMentionCount: 0,
        },
      },
    })
  })

  // The switch-on (2026-10-30): a consent recorded before it is under a notice, a
  // deployment profile and a runtime profile the catalogue no longer serves, and none of
  // the three keeps AI running. The review is settled as not analysable and nothing is
  // claimed or sent until an AccountAdmin confirms the new notice and the epoch bump
  // analyses the history again.
  it.each([
    {
      name: 'the 2026-10-17 notice, in force until the switch-on',
      options: {
        consentNotice: {
          noticeVersion: 'merchant-ai-notice-2026-10-17.v1',
          noticeDigest:
            '2bcd2be15cbb81f324f9a9390ad00baff3ffbb25a6c0db8bff71fbb2b1b0975e',
        },
      },
    },
    {
      name: 'the 2026-09-15 notice, in force until the switch-on',
      options: {
        consentNotice: {
          noticeVersion: 'merchant-ai-notice-2026-09-15.v1',
          noticeDigest:
            '6c98ae3bb57b5b142afed1749a1b9f59be8d6ca7edaca3250e39055897289a9c',
        },
      },
    },
    {
      name: 'the v2 runtime profile',
      options: { runtimeProfile: 'review-analysis-runtime-v1' },
    },
    {
      name: 'the v1 provider deployment',
      options: { providerDeployment: 'private-beta-global-v1' },
    },
  ])(
    'does not serve a consent recorded under $name, and asks no provider',
    async (scenario) => {
      const { analyze, mocks } = harness(scenario.options)

      expect(await analyze(input)).toEqual({ status: 'terminal' })

      expect(mocks.claim).not.toHaveBeenCalled()
      expect(mocks.analyzeReview).not.toHaveBeenCalled()
      expect(mocks.settleOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'terminal_no_result',
          dispositionCode: 'policy_disabled',
        }),
      )
    },
  )

  it.each([
    {
      name: 'the operator has chosen no provider',
      choice: {
        status: 'unavailable' as const,
        code: 'provider_selection_required' as const,
      },
      code: 'provider_selection_required',
    },
    {
      name: 'the chosen provider cannot take a call',
      choice: { status: 'unavailable' as const, code: 'provider_unavailable' as const },
      code: 'provider_unavailable',
    },
  ])('waits within the horizon when $name, and claims nothing', async (scenario) => {
    const { analyze, mocks } = harness({ choice: scenario.choice })

    const result = await analyze(input)

    expect(result).toMatchObject({ status: 'retry', code: scenario.code })
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(mocks.analyzeReview).not.toHaveBeenCalled()
  })

  it('waits when the source gave no numbered sentences', async () => {
    const { analyze, mocks } = harness({ sentences: undefined })

    expect(await analyze(input)).toMatchObject({
      status: 'retry',
      code: 'sentences_unavailable',
    })
    expect(mocks.claim).not.toHaveBeenCalled()
  })

  it('uses the generic hints for a Property with no category', async () => {
    const { analyze, mocks } = harness({ category: null })

    await analyze(input)

    expect(mocks.claim.mock.calls[0]?.[0].vocabularyHints).toEqual(
      resolveReviewPropertyContext(null).hintIdentity,
    )
  })

  it('records a charged output_invalid when the gateway returns an answer that is not the normalized contract', async () => {
    const { analyze, mocks } = harness({
      result: { sentiment: 'positive', mentions: [] },
    })

    expect(await analyze(input)).toEqual({ status: 'terminal' })

    expect(mocks.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: 'output_invalid',
        retryAtEpochMillis: null,
      }),
    )
    expect(mocks.storeAnalysisV3).not.toHaveBeenCalled()
  })

  it('reports a generation change when the store refuses the write', async () => {
    const { analyze, mocks } = harness({ stored: false })

    expect(await analyze(input)).toEqual({ status: 'generation_changed' })

    expect(mocks.applyReviewAnalysis).not.toHaveBeenCalled()
    expect(mocks.markDelivered).not.toHaveBeenCalled()
  })
})
