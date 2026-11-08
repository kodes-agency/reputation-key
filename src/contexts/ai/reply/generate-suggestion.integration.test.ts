import {
  BRAND_DISPLAY_NAME_DIGEST,
  INPUT,
  NOW,
  OPERATION_ID,
  ORGANIZATION_ID,
  PROPERTY_ID,
  REVIEW_ID,
  SHA,
  createHarness,
} from '#/contexts/ai/infrastructure/testing/reply-handler.test-fixtures'
import { parseCanonicalReplyLanguageTag } from '#/shared/ai-review-language-catalogue'
import { describe, expect, it, vi } from 'vitest'

// Historical v1 remains readable; these contract regressions deliberately pin its old execution.
vi.mock('#/shared/ai-runtime-capability-contract', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('#/shared/ai-runtime-capability-contract')>()
  const { historicalReplyRuntime } =
    await import('#/shared/testing/historical-reply-runtime')
  return historicalReplyRuntime(actual)
})
function expectNoAiExecution(...mocks: readonly unknown[]): void {
  for (const mock of mocks) expect(mock).not.toHaveBeenCalled()
}

describe('generate reply suggestion', () => {
  it('rejects a stale browser base revision before claiming an operation', async () => {
    const harness = await createHarness({ currentReplyStateRevision: 4 })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'source_changed',
      retryAfterEpochMillis: null,
    })
    expect(harness.mocks.claim).not.toHaveBeenCalled()
    expect(harness.mocks.generateReply).not.toHaveBeenCalled()
  })

  it('loads a property-language template for a textless review without AI execution', async () => {
    const harness = await createHarness({
      reviewText: null,
      propertyReplyLanguage: 'bg-Cyrl-BG',
    })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'fallback',
      kind: 'local_safe_template',
      reason: 'no_review_text',
      languageSource: 'property_default',
      replyText:
        'Благодарим ви, че споделихте този положителен отзив. Радваме се, че преживяването ви е било приятно.',
      concreteLanguageTag: 'bg-Cyrl-BG',
    })
    expect(harness.mocks.resolveReplyLanguage).not.toHaveBeenCalled()
    expectNoAiExecution(
      harness.mocks.readMerchantAuthorization,
      harness.mocks.readProcessingProfile,
      harness.mocks.readCurrentAiReplyBrandProfile,
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
  })

  it('keeps an Arabic catalogue fallback unframed when no local voice exists', async () => {
    const harness = await createHarness({
      reviewText: null,
      propertyReplyLanguage: 'ar-Arab',
      replyLocalFrame: null,
    })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'fallback',
      kind: 'local_safe_template',
      reason: 'no_review_text',
      languageSource: 'property_default',
      replyText:
        'شكرًا لمشاركة هذا التقييم الإيجابي. يسعدنا أن تجربتك كانت ممتعة وتركت لديك انطباعًا طيبًا.',
      concreteLanguageTag: 'ar-Arab',
    })
  })

  it('frames an English catalogue fallback when a local voice exists', async () => {
    const harness = await createHarness({
      reviewText: null,
      propertyReplyLanguage: 'en-Latn',
      replyLocalFrame: {
        prefix: 'Hi Maria,',
        suffix: 'Warm regards,\nHarbor House Team',
        voiceDigest: SHA,
        reviewerDisplayName: 'Maria Lopez',
        contact: null,
        signerName: null,
        signerTitle: null,
        businessName: 'Harbor House',
      },
    })

    await expect(harness.generate(INPUT)).resolves.toMatchObject({
      status: 'fallback',
      replyText:
        'Hi Maria,\n\nThank you for sharing this positive review. We are pleased that your experience was enjoyable.\n\nWarm regards,\nHarbor House Team',
    })
  })

  it('keeps a personalized reply body unframed when no local voice exists', async () => {
    const harness = await createHarness({ replyLocalFrame: null })

    await expect(harness.generate(INPUT)).resolves.toMatchObject({
      status: 'ready',
      replyText: 'Thank you for your thoughtful review.',
    })
    expect(harness.mocks.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({ replyLocalFrame: null }),
      expect.any(AbortSignal),
    )
  })
  it('serves an explicit catalogue request without merchant AI admission or execution', async () => {
    const harness = await createHarness({ propertyReplyLanguage: 'en-Latn' })

    await expect(
      harness.generate({
        ...INPUT,
        targetLanguage: { kind: 'property_default' },
        templateOnly: true,
      }),
    ).resolves.toMatchObject({
      status: 'fallback',
      kind: 'local_safe_template',
      reason: 'template_requested',
      languageSource: 'explicit',
    })
    expectNoAiExecution(
      harness.mocks.readMerchantAuthorization,
      harness.mocks.readProcessingProfile,
      harness.mocks.readCurrentAiReplyBrandProfile,
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
  })
  it.each([
    [
      4,
      'Thank you for sharing this positive review. We are pleased that your experience was enjoyable.',
    ],
    [
      3,
      'Thank you for sharing your perspective. We appreciate the time you took to describe your experience.',
    ],
    [
      2,
      'Thank you for explaining your concerns. We recognize that this experience was disappointing.',
    ],
    [
      1,
      'We are sorry that the service did not meet expectations. Your feedback is important to our team.',
    ],
  ] as const)('selects the rating-%i catalogue intent', async (rating, replyText) => {
    const harness = await createHarness({
      reviewText: null,
      rating,
      propertyReplyLanguage: 'en-Latn',
    })

    await expect(
      harness.generate({
        ...INPUT,
        targetLanguage: { kind: 'property_default' },
      }),
    ).resolves.toMatchObject({
      status: 'fallback',
      reason: 'no_review_text',
      languageSource: 'explicit',
      replyText,
    })
  })

  it('fails closed before admission when the Property Brand Profile is unavailable', async () => {
    const harness = await createHarness({ brandProfile: null })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'brand_profile_unavailable',
      retryAfterEpochMillis: null,
    })
    expect(harness.mocks.claim).not.toHaveBeenCalled()
    expect(harness.mocks.generateReply).not.toHaveBeenCalled()
  })

  it.each([
    {
      targetLanguage: { kind: 'review_language' } as const,
      languageSource: 'property_default',
    },
    {
      targetLanguage: { kind: 'property_default' } as const,
      languageSource: 'explicit',
    },
  ])(
    'loads a chosen-language template for undetectable text ($languageSource)',
    async ({ targetLanguage, languageSource }) => {
      const harness = await createHarness({
        reviewText: 'Nice',
        propertyReplyLanguage: 'bg-Cyrl-BG',
        replyLanguage: {
          status: 'language_not_supported',
          reason: 'insufficient_language_evidence',
        },
      })

      await expect(harness.generate({ ...INPUT, targetLanguage })).resolves.toEqual({
        status: 'fallback',
        kind: 'local_safe_template',
        reason: 'language_undetermined',
        languageSource,
        replyText:
          'Благодарим ви, че споделихте този положителен отзив. Радваме се, че преживяването ви е било приятно.',
        concreteLanguageTag: 'bg-Cyrl-BG',
      })
      expectNoAiExecution(
        harness.mocks.readMerchantAuthorization,
        harness.mocks.readProcessingProfile,
        harness.mocks.readCurrentAiReplyBrandProfile,
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

  it('returns the existing target-language refusal when no default can resolve undetectable text', async () => {
    const harness = await createHarness({
      reviewText: 'Nice',
      replyLanguage: {
        status: 'language_not_supported',
        reason: 'insufficient_language_evidence',
      },
    })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'target_language_unavailable',
      retryAfterEpochMillis: null,
    })
    expectNoAiExecution(
      harness.mocks.readHeads,
      harness.mocks.claim,
      harness.mocks.claimExecution,
      harness.mocks.acquire,
      harness.mocks.generateReply,
    )
  })

  it('keeps a metadata mismatch unavailable', async () => {
    const harness = await createHarness({
      replyLanguage: {
        status: 'language_not_supported',
        reason: 'metadata_language_mismatch',
      },
    })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'language_not_supported',
      retryAfterEpochMillis: null,
    })
    expect(harness.mocks.generateReply).not.toHaveBeenCalled()
  })

  it('binds settlement and delivery to the current durable reply head', async () => {
    const harness = await createHarness()

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'ready',
      profileVersion: 'reply-draft-v3',
      replyText: 'Thank you for your thoughtful review.',
      provenanceToken: 'signed-provenance-token',
      expiresAtEpochMillis: NOW + 5 * 60_000,
      baseReplyStateRevision: 3,
      concreteLanguageTag: 'en-Latn',
    })
    expect(harness.mocks.readReplyStateRevision).toHaveBeenCalledTimes(2)
    expect(harness.mocks.settleEphemeralReply).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewId: REVIEW_ID,
        baseReplyStateRevision: 3,
        replyDraftingEpoch: 7,
        operationProfileVersion: 'reply-suggestion-v1',
        replyProfileVersion: 'reply-draft-v3',
      }),
    )
    expect(harness.mocks.markDelivered).toHaveBeenCalledWith({
      operationId: OPERATION_ID,
      organizationId: ORGANIZATION_ID,
      expectedAttempt: 1,
      deliveredAtEpochMillis: NOW,
    })
    expect(harness.mocks.release).toHaveBeenCalledWith({ admissionId: 'admission-1' })
    expect(harness.mocks.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        replyProfileVersion: 'reply-draft-v3',
        brandProfile: { displayName: 'Example Hotel' },
        binding: expect.objectContaining({
          replyBrandProfileVersion: 7,
          replyBrandDisplayNameDigest: BRAND_DISPLAY_NAME_DIGEST,
        }),
      }),
      expect.any(AbortSignal),
    )
    expect(harness.mocks.readCurrentAiReplyBrandProfile).toHaveBeenCalledTimes(2)
  })

  it('answers busy from a full interactive lane without claiming an attempt', async () => {
    const harness = await createHarness({ admissionBusyUntil: NOW + 12_000 })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'busy',
      retryAfterEpochMillis: NOW + 12_000,
    })
    expect(harness.mocks.acquire).toHaveBeenCalledWith(
      expect.objectContaining({ lane: 'interactive', propertyId: PROPERTY_ID }),
    )
    expect(harness.mocks.claimExecution).not.toHaveBeenCalled()
    expect(harness.mocks.generateReply).not.toHaveBeenCalled()
    expect(harness.mocks.release).not.toHaveBeenCalled()
  })

  it('withholds a provider result when the public Brand Profile changes in flight', async () => {
    const harness = await createHarness({
      brandProfileAfterProvider: {
        displayName: 'Example Hotel Sofia',
        version: 8,
        displayNameDigest: 'b'.repeat(64),
      },
    })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'brand_profile_changed',
      retryAfterEpochMillis: null,
    })
    expect(harness.mocks.settleEphemeralReply).not.toHaveBeenCalled()
    expect(harness.mocks.markDelivered).not.toHaveBeenCalled()
  })

  it('reports a Brand change that races the atomic settlement fence', async () => {
    const harness = await createHarness({
      settleEphemeralReplyResult: false,
      brandProfileAfterSettlement: {
        displayName: 'Example Hotel Sofia',
        version: 8,
        displayNameDigest: 'b'.repeat(64),
      },
    })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'brand_profile_changed',
      retryAfterEpochMillis: null,
    })
    expect(harness.mocks.settleEphemeralReply).toHaveBeenCalledTimes(1)
    expect(harness.mocks.markDelivered).not.toHaveBeenCalled()
  })

  it.each([
    'provider_unavailable',
    'provider_rate_limited',
    'provider_refused',
    'output_invalid',
    'output_truncated',
    'completed_without_delivery',
    'operation_ambiguous',
  ] as const)(
    'reports %s as unavailable instead of substituting a template',
    async (gatewayErrorCode) => {
      const harness = await createHarness({ gatewayErrorCode })

      const result = await harness.generate(INPUT)

      expect(result).toMatchObject({
        status: 'unavailable',
        code: 'provider_unavailable',
      })
      expect(harness.mocks.recordFailure).toHaveBeenCalledWith(
        expect.objectContaining({ failureCode: gatewayErrorCode, expectedAttempt: 1 }),
      )
      expect(harness.mocks.settleEphemeralReply).not.toHaveBeenCalled()
      expect(harness.mocks.markDelivered).not.toHaveBeenCalled()
      expect(harness.mocks.release).toHaveBeenCalledWith({ admissionId: 'admission-1' })
    },
  )

  // A charged attempt blocks every later attempt of the same operation at
  // admission, and the composer asks again under a new key. A scheduled retry
  // was never claimed: the reaper ended it as `operation_abandoned`, or a
  // replayed key was refused `already_consumed` and came back
  // `operation_ambiguous`, either way replacing the real code.
  it.each([
    'output_invalid',
    'output_truncated',
    'provider_refused',
    'completed_without_delivery',
  ] as const)(
    'ends the operation under its own code after a charged %s',
    async (gatewayErrorCode) => {
      const harness = await createHarness({ gatewayErrorCode })

      await expect(harness.generate(INPUT)).resolves.toEqual({
        status: 'unavailable',
        code: 'provider_unavailable',
        retryAfterEpochMillis: null,
      })
      expect(harness.mocks.recordFailure).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          expectedAttempt: 1,
          failureCode: gatewayErrorCode,
          retryAtEpochMillis: null,
          failedAtEpochMillis: NOW,
        }),
      )
    },
  )

  it.each([
    'provider_unavailable',
    'provider_rate_limited',
    'operation_ambiguous',
  ] as const)(
    'still schedules a retry of the operation after an uncharged %s',
    async (gatewayErrorCode) => {
      const harness = await createHarness({ gatewayErrorCode })

      await expect(harness.generate(INPUT)).resolves.toEqual({
        status: 'unavailable',
        code: 'provider_unavailable',
        retryAfterEpochMillis: NOW + 1_000,
      })
      expect(harness.mocks.recordFailure).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          failureCode: gatewayErrorCode,
          retryAtEpochMillis: NOW + 1_000,
        }),
      )
    },
  )

  it('waits briefly for an interactive slot that frees within the request', async () => {
    const sleep = vi.fn(async () => {})
    const harness = await createHarness({ admissionBusyOnceUntil: NOW + 1_500, sleep })

    await expect(harness.generate(INPUT)).resolves.toMatchObject({ status: 'ready' })
    expect(sleep).toHaveBeenCalledWith(1_500)
    expect(harness.mocks.acquire).toHaveBeenCalledTimes(2)
    expect(harness.mocks.claimExecution).toHaveBeenCalledOnce()
  })

  it('answers busy without waiting when the slot frees after the wait allows', async () => {
    const sleep = vi.fn(async () => {})
    const harness = await createHarness({ admissionBusyUntil: NOW + 30_000, sleep })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'busy',
      retryAfterEpochMillis: NOW + 30_000,
    })
    expect(sleep).not.toHaveBeenCalled()
    expect(harness.mocks.acquire).toHaveBeenCalledOnce()
  })

  it('resolves a property-default target from tenant-scoped server data', async () => {
    const harness = await createHarness({ propertyReplyLanguage: 'bg-Cyrl-BG' })

    await expect(
      harness.generate({
        ...INPUT,
        targetLanguage: { kind: 'property_default' },
      }),
    ).resolves.toMatchObject({
      status: 'ready',
      concreteLanguageTag: 'bg-Cyrl-BG',
    })
    expect(harness.mocks.readDefaultReplyLanguage).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
    })
    expect(harness.mocks.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        binding: expect.objectContaining({
          concreteReplyLanguage: {
            tag: 'bg-Cyrl-BG',
            templateGroup: 'bg-Cyrl',
          },
        }),
      }),
    )
    expect(harness.mocks.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        binding: expect.objectContaining({
          concreteReplyLanguage: {
            tag: 'bg-Cyrl-BG',
            templateGroup: 'bg-Cyrl',
          },
        }),
      }),
      expect.any(AbortSignal),
    )
  })

  it.each([null, 'bg', 'en-Latn-INVALID'])(
    'fails closed when the property default target is unavailable (%s)',
    async (propertyReplyLanguage) => {
      const harness = await createHarness({ propertyReplyLanguage })

      await expect(
        harness.generate({
          ...INPUT,
          targetLanguage: { kind: 'property_default' },
        }),
      ).resolves.toEqual({
        status: 'unavailable',
        code: 'target_language_unavailable',
        retryAfterEpochMillis: null,
      })
      expect(harness.mocks.claim).not.toHaveBeenCalled()
      expect(harness.mocks.generateReply).not.toHaveBeenCalled()
    },
  )

  it('does not consult the property default for a review-language target', async () => {
    const harness = await createHarness({ propertyReplyLanguage: 'bg-Cyrl-BG' })

    await harness.generate(INPUT)

    expect(harness.mocks.readDefaultReplyLanguage).not.toHaveBeenCalled()
    expect(harness.mocks.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        binding: expect.objectContaining({
          concreteReplyLanguage: {
            tag: 'en-Latn',
            templateGroup: 'en-Latn',
          },
        }),
      }),
    )
  })

  it('uses the catalogue when a resolved language has no personalized profile', async () => {
    const text =
      'Bulgaristan’da nadir görülen konforlu bir mekan ve konaklamada sabah kahvaltısı dahil.'
    const harness = await createHarness({
      reviewText: text,
      reviewLanguageCode: null,
      replyLanguage: {
        status: 'resolved',
        language: parseCanonicalReplyLanguageTag('tr-Latn'),
      },
    })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'fallback',
      kind: 'local_safe_template',
      reason: 'language_not_personalized',
      languageSource: 'explicit',
      replyText:
        'Bu olumlu değerlendirmeyi paylaştığınız için teşekkür ederiz. Deneyiminizin keyifli geçmesine sevindik.',
      concreteLanguageTag: 'tr-Latn',
    })
    expect(harness.mocks.resolveReplyLanguage).toHaveBeenCalledWith({
      text,
      evaluatedLanguage: { tag: 'und', group: 'und' },
    })
    expectNoAiExecution(
      harness.mocks.readHeads,
      harness.mocks.claim,
      harness.mocks.claimExecution,
      harness.mocks.acquire,
      harness.mocks.generateReply,
    )
  })
})

// ── Characterization: the branches the use case settles before provider work ──
