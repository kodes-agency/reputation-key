import {
  ACTOR_USER_ID,
  BRAND_DISPLAY_NAME_DIGEST,
  INPUT,
  LINEAGE_ID,
  NOW,
  ORGANIZATION_ID,
  PROPERTY_ID,
  REVIEW_ID,
  SHA,
  createHarness,
} from '#/contexts/ai/infrastructure/testing/reply-handler.test-fixtures'
import { parseAiGatewayRouteRequest } from '#/shared/ai-gateway-transport-contract'
import { AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST } from '#/shared/ai-language-script-consistency'
import { AI_SOURCE_CANONICALIZER_PROFILE_V1 } from '#/shared/ai-operation-profiles'
import { AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST } from '#/shared/ai-reply-language-verifier'
import {
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
} from '#/shared/ai-reply-output-leakage'
import {
  AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
  AI_REPLY_TEMPLATE_CATALOGUE_VERSION,
} from '#/shared/ai-reply-template-catalogue'
import {
  LANGUAGE_CATALOGUE_DIGEST,
  mapReviewLanguageMetadata,
  parseCanonicalReplyLanguageTag,
} from '#/shared/ai-review-language-catalogue'
import { encodeCanonicalAiReviewSource } from '#/shared/ai-review-source-contract'
import { AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST } from '#/shared/ai-zh-orthography-verifier'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { describe, expect, it, vi } from 'vitest'

import {
  aiRequestFingerprint,
  aiReviewSourceProvenance,
} from '../application/ai-workflow-support'
import type { AiAuthorizationPort } from '../application/ports/ai-authorization.port'
import type { AiOperationState } from '../application/ports/ai-operation-store.port'
function expectNoAiExecution(...mocks: readonly unknown[]): void {
  for (const mock of mocks) expect(mock).not.toHaveBeenCalled()
}

type MerchantAuthorization = NonNullable<
  Awaited<ReturnType<AiAuthorizationPort['readMerchantAuthorization']>>
>
type Harness = Awaited<ReturnType<typeof createHarness>>

/** Persist valid grant changes; exercise impossible records only at the port boundary. */
async function changeAuthorization(
  harness: Harness,
  change: (authorization: MerchantAuthorization) => MerchantAuthorization | null,
): Promise<void> {
  const read = vi.mocked(harness.mocks.readMerchantAuthorization)
  const current = await harness.persistence.readAuthorization()
  if (!current) throw new Error('fixture authorization missing')
  const changed = change(current)
  if (changed === null) await harness.persistence.grant({ state: 'disabled' })
  else if (changed.authorizationLineageId === null && changed.state === 'enabled')
    read.mockResolvedValueOnce(changed)
  else await harness.persistence.grant(changed)
}

const REFUSED_AUTHORIZATIONS: ReadonlyArray<
  readonly [
    string,
    (authorization: MerchantAuthorization) => MerchantAuthorization | null,
  ]
> = [
  ['no merchant authorization', () => null],
  ['an authorization that is not enabled', (a) => ({ ...a, state: 'disabled' })],
  ['an authorization without a lineage', (a) => ({ ...a, authorizationLineageId: null })],
  [
    'an authorization for another source epoch',
    (a) => ({ ...a, authorizedSourceEpoch: 3 }),
  ],
  [
    'an authorization without reply drafting',
    (a) => ({ ...a, capabilities: ['review_analysis'] }),
  ],
]

describe('generate reply suggestion: compatible execution refresh', () => {
  it('executes the served profile despite different recorded runtime and deployment evidence', async () => {
    const harness = await createHarness()
    await changeAuthorization(harness, (authorization) => ({
      ...authorization,
      capabilityRuntimeProfileVersions: { reply_drafting: 'reply-drafting-runtime-v1' },
      providerDeploymentProfileVersion: 'private-beta-global-v1',
    }))
    await expect(harness.generate(INPUT)).resolves.toMatchObject({ status: 'ready' })
    const request = harness.mocks.generateReply.mock.calls[0]?.[0]
    expect(() => parseAiGatewayRouteRequest(request)).not.toThrow()
    expect(request).toMatchObject({
      binding: { providerDeploymentProfileVersion: 'private-beta-global-v3' },
    })
  })
})

describe('generate reply suggestion: refusals before provider work', () => {
  it.each(REFUSED_AUTHORIZATIONS)(
    'answers not_authorized for %s',
    async (_label, change) => {
      const absent = _label === 'no merchant authorization'
      const harness = await createHarness({
        authorization: absent ? 'absent' : undefined,
      })
      if (!absent) await changeAuthorization(harness, change)

      await expect(harness.generate(INPUT)).resolves.toEqual({
        status: 'unavailable',
        code: 'not_authorized',
        retryAfterEpochMillis: null,
      })
      expectNoAiExecution(
        harness.mocks.readHeads,
        harness.mocks.claim,
        harness.mocks.acquire,
        harness.mocks.generateReply,
      )
    },
  )

  it('answers not_authorized while the Property processing profile is unavailable', async () => {
    const harness = await createHarness()
    vi.mocked(harness.mocks.readProcessingProfile).mockResolvedValueOnce({
      status: 'policy_unavailable',
    })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'not_authorized',
      retryAfterEpochMillis: null,
    })
    expectNoAiExecution(harness.mocks.readHeads, harness.mocks.claim)
  })

  it('answers policy_unavailable when the execution stop fence is not fully open', async () => {
    const harness = await createHarness()
    vi.mocked(harness.mocks.readHeads).mockImplementationOnce((request) =>
      harness.persistence.controlAdapter.readHeads({
        ...request,
        providerDeploymentProfileVersion: 'unconfigured-profile',
      }),
    )

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'policy_unavailable',
      retryAfterEpochMillis: null,
    })
    expectNoAiExecution(harness.mocks.claim, harness.mocks.acquire)
  })

  it('answers policy_unavailable when the operation claim conflicts', async () => {
    const harness = await createHarness()
    // The idempotency key already holds a request with another fingerprint.
    harness.persistence.seedClaim({ requestFingerprint: 'f'.repeat(64) })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'policy_unavailable',
      retryAfterEpochMillis: null,
    })
    expectNoAiExecution(harness.mocks.claimExecution, harness.mocks.generateReply)
  })

  it.each([
    'succeeded',
    'succeeded_pending_delivery',
  ] as const satisfies ReadonlyArray<AiOperationState>)(
    'answers completed_without_delivery for an operation already %s',
    async (state) => {
      const harness = await createHarness()
      harness.persistence.seedClaim({ state, executionAttempt: 1 })

      await expect(harness.generate(INPUT)).resolves.toEqual({
        status: 'unavailable',
        code: 'completed_without_delivery',
        retryAfterEpochMillis: null,
      })
      expectNoAiExecution(harness.mocks.claimExecution, harness.mocks.generateReply)
    },
  )
})

describe('generate reply suggestion: review-language metadata', () => {
  it.each([
    [
      { status: 'language_not_supported', reason: 'unsupported_group' },
      'language_not_supported',
    ],
    [{ status: 'policy_unavailable' }, 'policy_unavailable'],
  ] as const)('refuses %o metadata without a template request', async (mapped, code) => {
    const harness = await createHarness({ propertyReplyLanguage: 'bg-Cyrl-BG' })
    vi.mocked(mapReviewLanguageMetadata).mockReturnValueOnce(mapped)

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code,
      retryAfterEpochMillis: null,
    })
    expectNoAiExecution(
      harness.mocks.resolveReplyLanguage,
      harness.mocks.readDefaultReplyLanguage,
    )
  })

  it('serves a requested template for unsupported metadata in the property language', async () => {
    const harness = await createHarness({ propertyReplyLanguage: 'bg-Cyrl-BG' })
    vi.mocked(mapReviewLanguageMetadata).mockReturnValueOnce({
      status: 'language_not_supported',
      reason: 'unsupported_group',
    })

    await expect(harness.generate({ ...INPUT, templateOnly: true })).resolves.toEqual({
      status: 'fallback',
      kind: 'local_safe_template',
      reason: 'language_undetermined',
      languageSource: 'property_default',
      replyText:
        'Благодарим ви, че споделихте този положителен отзив. Радваме се, че преживяването ви е било приятно.',
      concreteLanguageTag: 'bg-Cyrl-BG',
    })
    expectNoAiExecution(
      harness.mocks.resolveReplyLanguage,
      harness.mocks.readMerchantAuthorization,
    )
  })

  it('refuses a requested template for unsupported metadata without a property language', async () => {
    const harness = await createHarness()
    vi.mocked(mapReviewLanguageMetadata).mockReturnValueOnce({
      status: 'language_not_supported',
      reason: 'unsupported_group',
    })

    await expect(harness.generate({ ...INPUT, templateOnly: true })).resolves.toEqual({
      status: 'unavailable',
      code: 'target_language_unavailable',
      retryAfterEpochMillis: null,
    })
  })

  it('refuses an unavailable language verifier unless a template was requested', async () => {
    const refused = await createHarness({
      propertyReplyLanguage: 'bg-Cyrl-BG',
      replyLanguage: { status: 'policy_unavailable' },
    })
    const templated = await createHarness({
      propertyReplyLanguage: 'bg-Cyrl-BG',
      replyLanguage: { status: 'policy_unavailable' },
    })

    await expect(refused.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'policy_unavailable',
      retryAfterEpochMillis: null,
    })
    await expect(
      templated.generate({ ...INPUT, templateOnly: true }),
    ).resolves.toMatchObject({
      status: 'fallback',
      reason: 'language_undetermined',
      languageSource: 'property_default',
      concreteLanguageTag: 'bg-Cyrl-BG',
    })
  })
})

describe('generate reply suggestion: operation binding', () => {
  // The identity and binding feed the RFC 8785 request fingerprint that makes
  // a claim idempotent, so any change to a field, a key or a null here is a
  // different operation. Spelled out field by field, independently of the use
  // case's own builders.
  it('claims exactly this identity, binding and request fingerprint for a fixed input', async () => {
    const harness = await createHarness()

    await expect(harness.generate(INPUT)).resolves.toMatchObject({ status: 'ready' })

    const identity = {
      subjectKind: 'property',
      command: 'reply',
      capability: 'reply_drafting',
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      actorId: ACTOR_USER_ID,
      systemPrincipal: null,
      reviewId: REVIEW_ID,
      sourceEpoch: 2,
      sourceRevision: 5,
      tone: 'professional',
      reviewedAtEpochMillis: NOW - 1_000,
      baseReplyStateRevision: 3,
    }
    const binding = {
      authorizationLineageId: LINEAGE_ID,
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      capabilityFence: {
        capability: 'reply_drafting',
        replyDraftingEpoch: 7,
        baseReplyStateRevision: 3,
      },
      sourceEpoch: 2,
      evaluatedLanguage: 'en-Latn',
      concreteReplyLanguage: parseCanonicalReplyLanguageTag('en-Latn'),
      languageCatalogueDigest: LANGUAGE_CATALOGUE_DIGEST,
      replyLanguageVerifierDigest: AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST,
      languageScriptConsistencyDigest: AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST,
      zhOrthographyVerifierDigest: AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST,
      sourceRevision: 5,
      reviewedAtEpochMillis: NOW - 1_000,
      propertyProfileVersion: 3,
      replyBrandProfileVersion: 7,
      replyBrandDisplayNameDigest: BRAND_DISPLAY_NAME_DIGEST,
      routingPolicyVersion: 1,
      sourcePolicyId: AI_SOURCE_CANONICALIZER_PROFILE_V1.sourcePolicyId,
      sourceCanonicalizerDigest:
        AI_SOURCE_CANONICALIZER_PROFILE_V1.sourceCanonicalizerDigest,
      redactionProfileVersion: 'gbp-review-global-v1',
      outputLeakageProfileVersion: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
      outputLeakageProfileDigest: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
      replyTemplateCatalogueVersion: AI_REPLY_TEMPLATE_CATALOGUE_VERSION,
      replyTemplateCatalogueDigest: AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
      providerDeploymentProfileVersion: 'private-beta-global-v3',
      operationProfileVersion: 'reply-suggestion-v2',
      capabilityRuntimeProfileVersion: 'reply-drafting-runtime-v2',
      aiSubjectHmacKeyVersion: null,
      replyDraftingV2: expect.objectContaining({
        parentOperationId: null,
        rewriteOrdinal: 0,
        rewriteIssues: [],
        voiceDigest: SHA,
      }),
      stopFence: {
        globalControlId: harness.persistence.openHeads[0]!.controlId,
        globalGeneration: harness.persistence.openHeads[0]!.generation,
        providerControlId: expect.any(String),
        providerGeneration: expect.any(Number),
        capabilityControlId: harness.persistence.openHeads[2]!.controlId,
        capabilityGeneration: harness.persistence.openHeads[2]!.generation,
      },
    }
    const sourceProvenance = aiReviewSourceProvenance(
      encodeCanonicalAiReviewSource({
        text: 'A thoughtful review.',
        rating: 5,
        languageCode: 'en-US',
        reviewedAtEpochMillis: NOW - 1_000,
      }).bytes,
    )
    const request = harness.mocks.claim.mock.calls[0]?.[0]
    expect(request?.identity).toStrictEqual(identity)
    expect(request?.binding).toStrictEqual(binding)
    expect(request?.sourceProvenance).toStrictEqual(sourceProvenance)
    expect(request?.requestFingerprint).toBe(
      aiRequestFingerprint({
        identity,
        binding: request?.binding,
        sourceProvenance,
      }),
    )
    expect(request?.idempotencyKey).toBe('reply-suggestion-test-key')
    expect(request?.expiresAtEpochMillis).toBe(NOW + 15 * 60_000)
  })
})

// A new notice version ships with a deploy. A Property enabled under the
// previous one keeps that version on its enablement until an AccountAdmin
// confirms the new notice. The gateway's request check refuses such a draft
// by throwing, and that used to be the only place the two were compared:
// after the operation and an execution attempt had been claimed, so the
// manager got an unclassified server error.
describe('generate reply suggestion: a consent recorded under an earlier notice', () => {
  // The switch-on notice (2026-10-30) is the only one in force: a Property consented
  // under 2026-10-17 or 2026-09-15 is told its consent needs renewing, and nothing is
  // claimed, until an AccountAdmin confirms the new notice.
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

  it('sends a request the gateway accepts when the consent is under the served notice', async () => {
    const harness = await createHarness({ checksGatewayRequest: true })

    await expect(harness.generate(INPUT)).resolves.toMatchObject({ status: 'ready' })
    expect(harness.mocks.generateReply).toHaveBeenCalledOnce()
  })

  it.each([
    [
      'the 2026-10-30 notice, which needs renewal for drafting only',
      {
        noticeVersion: 'merchant-ai-notice-2026-10-30.v1',
        noticeDigest: 'dadad7b81dbda360678fc57f7265b104c7311cbc213f877f32306c53b4852a5e',
      },
    ],
    ['the 2026-10-17 notice, in force until the switch-on', NOTICE_2026_10_17],
    ['the 2026-09-15 notice, in force until the switch-on', NOTICE_2026_09_15],
    ['an earlier notice version', EARLIER_NOTICE],
    [
      'the served version with another text',
      { noticeVersion: MERCHANT_AI_NOTICE_VERSION, noticeDigest: SHA },
    ],
  ])(
    'answers that the consent needs renewing under %s, before anything is claimed',
    async (_case, consentNotice) => {
      const harness = await createHarness({ checksGatewayRequest: true, consentNotice })

      await expect(harness.generate(INPUT)).resolves.toEqual({
        status: 'unavailable',
        code: 'consent_renewal_required',
        retryAfterEpochMillis: null,
      })
      expectNoAiExecution(
        harness.mocks.readHeads,
        harness.mocks.claim,
        harness.mocks.claimExecution,
        harness.mocks.recordFailure,
        harness.mocks.acquire,
        harness.mocks.release,
        harness.mocks.generateReply,
        harness.mocks.settleEphemeralReply,
        harness.mocks.markDelivered,
      )
    },
  )

  it('keeps notice renewal actionable when the processing profile is also unavailable', async () => {
    const harness = await createHarness({ consentNotice: NOTICE_2026_10_17 })
    vi.mocked(harness.mocks.readProcessingProfile).mockResolvedValue({
      status: 'policy_unavailable',
    })
    await expect(harness.generate(INPUT)).resolves.toMatchObject({
      status: 'unavailable',
      code: 'consent_renewal_required',
    })
    expectNoAiExecution(
      harness.mocks.readHeads,
      harness.mocks.claim,
      harness.mocks.acquire,
      harness.mocks.generateReply,
    )
  })

  it('still loads the governed template, which needs no AI consent', async () => {
    const harness = await createHarness({
      consentNotice: EARLIER_NOTICE,
      propertyReplyLanguage: 'en-Latn',
    })

    await expect(
      harness.generate({ ...INPUT, templateOnly: true }),
    ).resolves.toMatchObject({
      status: 'fallback',
      kind: 'local_safe_template',
      reason: 'template_requested',
    })
    expect(harness.mocks.readMerchantAuthorization).not.toHaveBeenCalled()
  })
})
