import {
  CONTROL_STOPS,
  createHarness,
  input,
  LINEAGE_ID,
  NOW,
  OPERATION_ID,
  ORGANIZATION_ID,
  PROPERTY_ID,
  REVIEW_ID,
  SHA,
  withPinnedLanguageRuntime,
} from '#/contexts/ai/infrastructure/testing/review-analysis-handler.test-fixtures'
import { AI_SOURCE_CANONICALIZER_PROFILE_V1 } from '#/shared/ai-operation-profiles'
import { LANGUAGE_CATALOGUE_DIGEST } from '#/shared/ai-review-language-catalogue'
import { encodeCanonicalAiReviewSource } from '#/shared/ai-review-source-contract'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { beforeEach, describe, expect, it } from 'vitest'
import { aiRequestFingerprint, aiReviewSourceProvenance } from '../ai-workflow-support'
import type { AiOperationRecord } from '../ports/ai-operation-store.port'
describe('analyze review event: operation binding', () => {
  beforeEach(withPinnedLanguageRuntime)

  // The identity and binding feed the RFC 8785 request fingerprint that makes
  // a claim idempotent, so any change to a field, a key or a null here is a
  // different operation. Spelled out field by field, independently of the use
  // case's own builders.
  it('claims exactly this identity, binding and request fingerprint for a fixed event', async () => {
    const harness = await createHarness()

    await expect(harness.analyze(input)).resolves.toEqual({ status: 'completed' })

    const identity = {
      subjectKind: 'property',
      command: 'analysis',
      capability: 'review_analysis',
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      actorId: null,
      systemPrincipal: 'review_event_consumer',
      reviewId: REVIEW_ID,
      originEventId: input.eventEnvelopeId,
      subjectHmac: SHA,
      subjectHmacKeyVersion: 'ai-subject-hmac-v1',
      sourceEpoch: 2,
      sourceRevision: 5,
      reviewedAtEpochMillis: NOW - 1_000,
      analysisSequence: 7,
    }
    const binding = {
      authorizationLineageId: LINEAGE_ID,
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      capabilityFence: { capability: 'review_analysis', reviewAnalysisEpoch: 1 },
      sourceEpoch: 2,
      evaluatedLanguage: 'en-Latn',
      concreteReplyLanguage: null,
      languageCatalogueDigest: LANGUAGE_CATALOGUE_DIGEST,
      replyLanguageVerifierDigest: null,
      languageScriptConsistencyDigest: null,
      zhOrthographyVerifierDigest: null,
      sourceRevision: 5,
      reviewedAtEpochMillis: NOW - 1_000,
      propertyProfileVersion: 3,
      routingPolicyVersion: 1,
      sourcePolicyId: AI_SOURCE_CANONICALIZER_PROFILE_V1.sourcePolicyId,
      sourceCanonicalizerDigest:
        AI_SOURCE_CANONICALIZER_PROFILE_V1.sourceCanonicalizerDigest,
      redactionProfileVersion: 'gbp-review-global-v1',
      outputLeakageProfileVersion: null,
      outputLeakageProfileDigest: null,
      replyTemplateCatalogueVersion: null,
      replyTemplateCatalogueDigest: null,
      providerDeploymentProfileVersion: 'private-beta-global-v2',
      operationProfileVersion: 'review-analysis-v2',
      capabilityRuntimeProfileVersion: 'review-analysis-runtime-v1',
      aiSubjectHmacKeyVersion: 'ai-subject-hmac-v1',
      stopFence: {
        globalControlId: harness.persistence.openHeads[0]!.controlId,
        globalGeneration: harness.persistence.openHeads[0]!.generation,
        providerControlId: harness.persistence.openHeads[1]!.controlId,
        providerGeneration: harness.persistence.openHeads[1]!.generation,
        capabilityControlId: harness.persistence.openHeads[2]!.controlId,
        capabilityGeneration: harness.persistence.openHeads[2]!.generation,
      },
    }
    const provenance = aiReviewSourceProvenance(
      encodeCanonicalAiReviewSource({
        text: 'The kitchen made several guests sick.',
        rating: 1,
        languageCode: 'en-US',
        reviewedAtEpochMillis: NOW - 1_000,
      }).bytes,
    )
    const request = harness.mocks.claim.mock.calls[0]?.[0]
    expect(request?.identity).toStrictEqual(identity)
    expect(request?.binding).toStrictEqual(binding)
    expect(request?.sourceProvenance).toStrictEqual(provenance)
    expect(request?.requestFingerprint).toBe(
      aiRequestFingerprint({ identity, binding, provenance }),
    )
    expect(request?.idempotencyKey).toBe(`analysis:${input.eventEnvelopeId}`)
    expect(request?.expiresAtEpochMillis).toBe(NOW + 24 * 60 * 60 * 1_000)
  })
})

// The worker's side of a consent that predates the served notice (the reply
// draft's side is in generate-reply-suggestion.test.ts). The gateway's request
// check was the only comparison, and it throws after the operation and an
// execution attempt are claimed: every delivery burned an attempt and left the
// operation executing, for the reaper to abandon and the sweep to reopen.
describe('analyze review event: a consent recorded under an earlier notice', () => {
  beforeEach(withPinnedLanguageRuntime)

  // A material analysis change requires renewal before any operation exists,
  // including consent that survived an intervening drafting-only change.
  const NOTICE_2026_11_01 = {
    noticeVersion: 'merchant-ai-notice-2026-11-01.v1',
    noticeDigest: 'e9574380fd1ba5f4b7bd7b9899bc5e6bdf371f9d9871584f33c5c1e6131290ef',
  }
  const NOTICE_2026_10_30 = {
    noticeVersion: 'merchant-ai-notice-2026-10-30.v1',
    noticeDigest: 'dadad7b81dbda360678fc57f7265b104c7311cbc213f877f32306c53b4852a5e',
  }
  const NOTICE_2026_10_17 = {
    noticeVersion: 'merchant-ai-notice-2026-10-17.v1',
    noticeDigest: '2bcd2be15cbb81f324f9a9390ad00baff3ffbb25a6c0db8bff71fbb2b1b0975e',
  }
  const NOTICE_2026_09_15 = {
    noticeVersion: 'merchant-ai-notice-2026-09-15.v1',
    noticeDigest: '6c98ae3bb57b5b142afed1749a1b9f59be8d6ca7edaca3250e39055897289a9c',
  }
  const EARLIER_NOTICE = {
    noticeVersion: 'merchant-ai-notice-2026-09-09.v1',
    noticeDigest: 'd80fe3b03f89697cde6c46810053248206aa3745b5f4a5522a24c1c2fdb438e1',
  }

  it('analyses under the served notice after the analysis notice correction', async () => {
    const harness = await createHarness({
      consentNotice: {
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      },
    })

    await expect(harness.analyze(input)).resolves.toEqual({ status: 'completed' })
    expect(harness.mocks.analyzeReview).toHaveBeenCalledOnce()
    expect(harness.mocks.advanceWithoutAnalysis).not.toHaveBeenCalled()
  })

  it.each([
    ['the 2026-11-01 drafting-only notice', NOTICE_2026_11_01],
    ['the 2026-10-30 analysis notice', NOTICE_2026_10_30],
    ['the 2026-10-17 notice, in force until the switch-on', NOTICE_2026_10_17],
    ['the 2026-09-15 notice, in force until the switch-on', NOTICE_2026_09_15],
    ['an earlier notice version', EARLIER_NOTICE],
    [
      'the served version with another text',
      { noticeVersion: MERCHANT_AI_NOTICE_VERSION, noticeDigest: SHA },
    ],
  ])(
    'settles the review as not analysable under %s, with no operation and no attempt',
    async (_case, consentNotice) => {
      const harness = await createHarness({ consentNotice })

      await expect(harness.analyze(input)).resolves.toEqual({ status: 'terminal' })
      expect(harness.mocks.advanceWithoutAnalysis).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          dispositionCode: 'policy_disabled',
        }),
      )
      expect(harness.mocks.claim).not.toHaveBeenCalled()
      expect(harness.mocks.acquire).not.toHaveBeenCalled()
      expect(harness.mocks.claimExecution).not.toHaveBeenCalled()
      expect(harness.mocks.analyzeReview).not.toHaveBeenCalled()
    },
  )

  it('queues no provider work for it when the caller defers', async () => {
    const harness = await createHarness({ consentNotice: EARLIER_NOTICE })

    await expect(harness.analyze({ ...input, execution: 'defer' })).resolves.toEqual({
      status: 'terminal',
    })
    expect(harness.mocks.readReviewSource).not.toHaveBeenCalled()
  })
})

// An operator stops Review Analysis with the AI execution controls (kill or
// drain, at the global, provider or capability scope) and restores it later.
// A review that arrives in between used to be settled "disabled" with no
// operation, which nothing reopens: the reopen pass selects by a failed
// operation and on-demand analysis only hurries a queued review. It stayed
// "not analysable" until the guest edited it or the AccountAdmin consented
// again.
describe('analyze review event: a stopped AI execution control', () => {
  beforeEach(withPinnedLanguageRuntime)

  describe.each(Object.entries(CONTROL_STOPS))('while %s', (_stop, controlStop) => {
    it.each(['execute', 'defer'] as const)(
      'answers stopped and settles nothing when the caller asks to %s',
      async (execution) => {
        const harness = await createHarness({ controlStop })

        await expect(harness.analyze({ ...input, execution })).resolves.toEqual({
          status: 'stopped',
        })
        expect(harness.mocks.advanceWithoutAnalysis).not.toHaveBeenCalled()
        expect(harness.mocks.applyReviewAnalysis).not.toHaveBeenCalled()
        expect(harness.mocks.claim).not.toHaveBeenCalled()
        expect(harness.mocks.acquire).not.toHaveBeenCalled()
        expect(harness.mocks.analyzeReview).not.toHaveBeenCalled()
      },
    )
  })

  // A stop holds provider work. What needs no provider call is still decided,
  // so the review does not wait for a restore that would change nothing.
  it('still settles a review the merchant switched AI off for', async () => {
    const harness = await createHarness({
      controlStop: CONTROL_STOPS['the capability is killed'],
      authorizationState: 'disabled',
    })

    await expect(harness.analyze(input)).resolves.toEqual({ status: 'terminal' })
    expect(harness.mocks.advanceWithoutAnalysis).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ dispositionCode: 'policy_disabled' }),
    )
  })

  it('still settles a source transition', async () => {
    const harness = await createHarness({
      controlStop: CONTROL_STOPS['the capability is killed'],
    })

    await expect(
      harness.analyze({ ...input, disposition: 'provider_deleted' }),
    ).resolves.toEqual({ status: 'terminal' })
    expect(harness.mocks.advanceWithoutAnalysis).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ dispositionCode: 'provider_deleted' }),
    )
  })
})

// Every kill, drain and restore of an AI execution control moves that
// control's generation, and the request fingerprint covers the generations. So
// an operation claimed before a stop can never be claimed again after the
// restore: the same idempotency key now answers `conflict`. That used to be
// settled "disabled" with no operation, like a foreign request, and the stale
// operation stayed pending until the reaper abandoned it at its 24-hour expiry.
describe('analyze review event: an operation claimed before the AI execution controls moved', () => {
  beforeEach(withPinnedLanguageRuntime)

  /**
   * A claim that answers as the store does: the first request is recorded, and
   * a later one under its idempotency key is a replay only when its fingerprint
   * is the recorded one. `recorded` is what earlier attempts left on it.
   */
  function seedEarlierOperation(
    harness: Awaited<ReturnType<typeof createHarness>>,
    recorded: Partial<AiOperationRecord> = {},
  ): void {
    harness.persistence.seedClaim({
      ...(recorded.state === undefined ? {} : { state: recorded.state }),
      ...(recorded.executionAttempt === undefined
        ? {}
        : { executionAttempt: recorded.executionAttempt }),
      ...(recorded.failureCode === undefined
        ? {}
        : { failureCode: recorded.failureCode }),
    })
  }

  /** The lane is full, so the first delivery claims its operation and waits. */
  async function claimedBeforeTheStop(recorded: Partial<AiOperationRecord> = {}) {
    const harness = await createHarness({ admissionCode: 'admission_busy' })
    seedEarlierOperation(harness, recorded)
    await expect(harness.analyze(input)).resolves.toMatchObject({
      status: 'retry',
      code: 'admission_busy',
    })
    return harness
  }

  it('claims the same operation again while the controls have not moved', async () => {
    const harness = await claimedBeforeTheStop()

    await expect(harness.analyze(input)).resolves.toMatchObject({
      status: 'retry',
      code: 'admission_busy',
    })
    expect(harness.mocks.recordFailure).not.toHaveBeenCalled()
    expect(harness.mocks.advanceWithoutAnalysis).not.toHaveBeenCalled()
    expect(harness.mocks.applyReviewAnalysis).not.toHaveBeenCalled()
  })

  it.each([
    ['its lane was full', {}, { expectedAttempt: 0, expectedFailureCode: null }],
    [
      'the provider said to come back later',
      { executionAttempt: 2, failureCode: 'provider_rate_limited' as const },
      { expectedAttempt: 2, expectedFailureCode: 'provider_rate_limited' },
    ],
  ])(
    'closes the operation it claimed when %s as suspended, and settles against it',
    async (_case, recorded, expected) => {
      const harness = await claimedBeforeTheStop(recorded)
      await harness.persistence.transition('killed')
      await harness.persistence.transition('enabled')

      await expect(harness.analyze(input)).resolves.toEqual({ status: 'terminal' })

      // `execution_suspended` is a code the reopen pass selects, so the review
      // gets a fresh sequence and a fresh operation at the next sweep.
      expect(harness.mocks.recordFailure).toHaveBeenCalledExactlyOnceWith({
        operationId: OPERATION_ID,
        organizationId: ORGANIZATION_ID,
        expectedState: 'pending',
        ...expected,
        failureCode: 'execution_suspended',
        retryAtEpochMillis: null,
        failedAtEpochMillis: NOW,
      })
      expect(harness.mocks.advanceWithoutAnalysis).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          dispositionCode: 'operation_abandoned',
        }),
      )
      expect(harness.mocks.advanceWithoutAnalysis).toHaveBeenCalledOnce()
      expect(harness.mocks.claimExecution).not.toHaveBeenCalled()
      expect(harness.mocks.analyzeReview).not.toHaveBeenCalled()
    },
  )

  it('still settles the review when the operation moved on before it could be closed', async () => {
    const harness = await claimedBeforeTheStop()
    await harness.persistence.transition('killed')
    await harness.persistence.transition('enabled')
    const recordFailure =
      harness.persistence.operations.recordFailure.getMockImplementation()!
    harness.mocks.recordFailure.mockImplementationOnce(async (request) => {
      await harness.persistence.patchOperation({
        state: 'failed',
        failureCode: 'output_invalid',
      })
      return recordFailure(request)
    })

    await expect(harness.analyze(input)).resolves.toEqual({ status: 'terminal' })
    expect(harness.mocks.advanceWithoutAnalysis).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        analysisSequence: input.analysisSequence,
        dispositionCode: 'operation_abandoned',
      }),
    )
  })

  // Only its own request, claimed under earlier controls, is the analysis's to
  // close. Anything else under the key stays as it was: settled as not
  // analysable, with the operation left to whoever owns it.
  it.each([
    ['is being executed', { state: 'executing' as const, executionAttempt: 1 }],
    [
      'already failed',
      { state: 'failed' as const, failureCode: 'output_invalid' as const },
    ],
  ])('leaves an operation that %s alone', async (_case, recorded) => {
    const harness = await claimedBeforeTheStop(recorded)
    await harness.persistence.transition('killed')
    await harness.persistence.transition('enabled')

    await expect(harness.analyze(input)).resolves.toEqual({ status: 'terminal' })
    expect(harness.mocks.recordFailure).not.toHaveBeenCalled()
    expect(harness.mocks.advanceWithoutAnalysis).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ dispositionCode: 'policy_disabled' }),
    )
  })

  it('leaves an operation alone when the request differs in more than the controls', async () => {
    const harness = await claimedBeforeTheStop()
    await harness.persistence.transition('killed')
    await harness.persistence.transition('enabled')

    await expect(harness.analyze({ ...input, sourceRevision: 6 })).resolves.toEqual({
      status: 'terminal',
    })
    expect(harness.mocks.recordFailure).not.toHaveBeenCalled()
    expect(harness.mocks.advanceWithoutAnalysis).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ dispositionCode: 'policy_disabled' }),
    )
  })
})
