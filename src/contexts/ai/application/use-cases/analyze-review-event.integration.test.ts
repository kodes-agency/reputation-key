import {
  NOW,
  VALID_ANALYSIS_RESULT,
  agedBackfillInput,
  createHarness,
  elapsedInput,
  input,
  withDriftedLanguageRuntime,
  withPinnedLanguageRuntime,
} from '#/contexts/ai/infrastructure/testing/review-analysis-handler.test-fixtures'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  AI_ANALYSIS_OPERATION_HORIZON_MILLIS,
  derivePrimaryCategoryV1,
} from './analyze-review-event'
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
      const harness = await createHarness({ consumeStatus: 'duplicate' })

      await expect(harness.analyze(input)).resolves.toEqual({ status: 'replayed' })
      expect(harness.mocks.readProcessingProfile).not.toHaveBeenCalled()
      expect(harness.mocks.readReviewSource).not.toHaveBeenCalled()
      expect(harness.mocks.analyzeReview).not.toHaveBeenCalled()
      expect(harness.mocks.storeAnalysis).not.toHaveBeenCalled()
      expect(harness.mocks.advanceWithoutAnalysis).not.toHaveBeenCalled()
      expect(harness.mocks.applyReviewAnalysis).not.toHaveBeenCalled()
    })

    it('fails unsupported languages closed without invoking the provider', async () => {
      const harness = await createHarness({ languageCode: 'sw-Latn' })

      await expect(harness.analyze(input)).resolves.toEqual({ status: 'terminal' })
      expect(harness.mocks.analyzeReview).not.toHaveBeenCalled()
      expect(harness.mocks.storeAnalysis).not.toHaveBeenCalled()
      expect(harness.mocks.advanceWithoutAnalysis).toHaveBeenCalledWith(
        expect.objectContaining({
          dispositionCode: 'language_not_supported',
        }),
      )
      expect(harness.mocks.advanceWithoutAnalysis).toHaveBeenCalledOnce()
    })

    it('defers provider work to the caller without claiming an operation', async () => {
      const harness = await createHarness()

      await expect(harness.analyze({ ...input, execution: 'defer' })).resolves.toEqual({
        status: 'deferred',
      })
      expect(harness.mocks.claim).not.toHaveBeenCalled()
      expect(harness.mocks.acquire).not.toHaveBeenCalled()
      expect(harness.mocks.analyzeReview).not.toHaveBeenCalled()
      expect(harness.mocks.advanceWithoutAnalysis).not.toHaveBeenCalled()
      expect(harness.mocks.applyReviewAnalysis).not.toHaveBeenCalled()
    })

    it('still settles a review with nothing to analyse when deferring', async () => {
      const harness = await createHarness({ languageCode: 'sw-Latn' })

      await expect(harness.analyze({ ...input, execution: 'defer' })).resolves.toEqual({
        status: 'terminal',
      })
      expect(harness.mocks.claim).not.toHaveBeenCalled()
      expect(harness.mocks.advanceWithoutAnalysis).toHaveBeenCalledOnce()
    })

    it('admits an on-demand analysis in the requested lane with its headroom', async () => {
      const harness = await createHarness()

      await expect(
        harness.analyze({ ...input, lane: 'interactive', admissionHeadroom: 1 }),
      ).resolves.toEqual({ status: 'completed' })
      expect(harness.mocks.acquire).toHaveBeenCalledWith(
        expect.objectContaining({ lane: 'interactive', headroom: 1 }),
      )
    })

    it('stores, aggregates, and delivers one successful analysis', async () => {
      const harness = await createHarness()

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
      expect(harness.mocks.release).toHaveBeenCalledWith({ admissionId: 'admission-1' })
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
        const harness = await createHarness({ analysisResult, rating })

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
      'rejects %s issue labels as output_invalid without storage or a retry',
      async (_case, issueLabel) => {
        const harness = await createHarness({
          analysisResult: {
            ...VALID_ANALYSIS_RESULT,
            issueLabel,
          },
        })

        await expect(harness.analyze(input)).resolves.toEqual({ status: 'terminal' })
        expect(harness.mocks.recordFailure).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            failureCode: 'output_invalid',
            retryAtEpochMillis: null,
          }),
        )
        expect(harness.mocks.storeAnalysis).not.toHaveBeenCalled()
        expect(harness.mocks.applyReviewAnalysis).not.toHaveBeenCalled()
      },
    )

    // The review reads "The kitchen made several guests sick." A label is
    // letters and spaces, so a phrase copied from the end of that sentence
    // arrives without its full stop.
    it.each([
      ['in the middle of a sentence', 'kitchen made several'],
      ['at the end of a sentence', 'guests sick'],
    ])(
      'stores the analysis without an issue label quoted from the review %s',
      async (_case, issueLabel) => {
        const harness = await createHarness({
          analysisResult: { ...VALID_ANALYSIS_RESULT, issueLabel },
        })

        await expect(harness.analyze(input)).resolves.toEqual({ status: 'completed' })
        expect(harness.mocks.storeAnalysis).toHaveBeenCalledWith(
          expect.objectContaining({
            result: {
              status: 'ready',
              derivative: expect.objectContaining({
                aspects: [{ aspect: 'service', polarity: 'negative', intensity: -90 }],
                issueLabel: null,
              }),
            },
          }),
        )
      },
    )

    it('finishes an idempotent aggregate replay when its outcome is already terminal', async () => {
      const harness = await createHarness({
        operationState: 'succeeded_pending_delivery',
      })

      await expect(harness.analyze(input)).resolves.toEqual({
        status: 'replayed',
      })
      expect(harness.mocks.analyzeReview).not.toHaveBeenCalled()
      expect(harness.mocks.applyReviewAnalysis).toHaveBeenCalledOnce()
      expect(harness.mocks.markDelivered).toHaveBeenCalledOnce()
    })

    it('does not mark a replay delivered when aggregate generations are stale', async () => {
      const harness = await createHarness({
        operationState: 'succeeded_pending_delivery',
        aggregateStatus: 'stale',
      })

      await expect(harness.analyze(input)).resolves.toEqual({
        status: 'generation_changed',
      })
      expect(harness.mocks.applyReviewAnalysis).toHaveBeenCalledOnce()
      expect(harness.mocks.markDelivered).not.toHaveBeenCalled()
    })

    it('defers an unavailable admission store instead of terminal-settling the outcome', async () => {
      const harness = await createHarness({ admissionCode: 'admission_unavailable' })

      await expect(harness.analyze(input)).resolves.toEqual({
        status: 'retry',
        retryAtEpochMillis: NOW + 30_000,
        code: 'admission_unavailable',
      })
      expect(harness.mocks.analyzeReview).not.toHaveBeenCalled()
      expect(harness.mocks.advanceWithoutAnalysis).not.toHaveBeenCalled()
      expect(harness.mocks.applyReviewAnalysis).not.toHaveBeenCalled()
    })

    it('keeps deferring an unavailable admission while the operation is inside its own horizon', async () => {
      // A relay backlog must not cut short work that has already been claimed:
      // once an operation exists it gets the full horizon from its own createdAt.
      const harness = await createHarness({ admissionCode: 'admission_unavailable' })

      await expect(harness.analyze(elapsedInput)).resolves.toMatchObject({
        status: 'retry',
        code: 'admission_unavailable',
      })
      expect(harness.mocks.advanceWithoutAnalysis).not.toHaveBeenCalled()
      expect(harness.mocks.applyReviewAnalysis).not.toHaveBeenCalled()
    })

    it('terminal-settles an unavailable admission once the operation horizon has elapsed', async () => {
      const harness = await createHarness({
        admissionCode: 'admission_unavailable',
        operationCreatedAtEpochMillis: NOW - AI_ANALYSIS_OPERATION_HORIZON_MILLIS,
      })

      await expect(harness.analyze(elapsedInput)).resolves.toEqual({
        status: 'terminal',
      })
      expect(harness.mocks.analyzeReview).not.toHaveBeenCalled()
      expect(harness.mocks.advanceWithoutAnalysis).toHaveBeenCalledWith(
        expect.objectContaining({
          dispositionCode: 'policy_disabled',
        }),
      )
      expect(harness.mocks.advanceWithoutAnalysis).toHaveBeenCalledOnce()
    })

    it('keeps deferring an unavailable admission for a backfill long after the live horizon', async () => {
      const harness = await createHarness({
        admissionCode: 'admission_unavailable',
        operationCreatedAtEpochMillis: NOW - AI_ANALYSIS_OPERATION_HORIZON_MILLIS,
      })

      await expect(harness.analyze(agedBackfillInput)).resolves.toMatchObject({
        status: 'retry',
        code: 'admission_unavailable',
      })
      expect(harness.mocks.advanceWithoutAnalysis).not.toHaveBeenCalled()
      expect(harness.mocks.applyReviewAnalysis).not.toHaveBeenCalled()
    })

    it('waits for a busy background lane even after the operation horizon', async () => {
      const harness = await createHarness({
        admissionCode: 'admission_busy',
        operationCreatedAtEpochMillis: NOW - AI_ANALYSIS_OPERATION_HORIZON_MILLIS,
      })

      await expect(harness.analyze(elapsedInput)).resolves.toEqual({
        status: 'retry',
        retryAtEpochMillis: NOW + 15_000,
        code: 'admission_busy',
      })
      expect(harness.mocks.acquire).toHaveBeenCalledWith(
        expect.objectContaining({ lane: 'background' }),
      )
      expect(harness.mocks.claimExecution).not.toHaveBeenCalled()
      expect(harness.mocks.analyzeReview).not.toHaveBeenCalled()
      expect(harness.mocks.advanceWithoutAnalysis).not.toHaveBeenCalled()
      expect(harness.mocks.applyReviewAnalysis).not.toHaveBeenCalled()
    })

    describe('provider capacity', () => {
      // A rate limit describes the provider, not the review. A batch backfill
      // under a per-minute token cap saw every fourth answer arrive within
      // seconds and settled half of a property's history as never analysable.
      it('retries a rate limit at the provider retry-after even on the last budgeted attempt', async () => {
        const harness = await createHarness({
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
        expect(harness.mocks.advanceWithoutAnalysis).not.toHaveBeenCalled()
        expect(harness.mocks.applyReviewAnalysis).not.toHaveBeenCalled()
      })

      it('keeps asking the provider past the budget while its last answer was capacity', async () => {
        const harness = await createHarness({
          operationExecutionAttempt: 6,
          operationFailureCode: 'provider_unavailable',
        })

        await expect(harness.analyze(input)).resolves.toEqual({ status: 'completed' })
        expect(harness.mocks.analyzeReview).toHaveBeenCalledOnce()
      })

      it('still terminal-settles a review the provider itself failed four times', async () => {
        const harness = await createHarness({
          operationExecutionAttempt: 4,
          operationFailureCode: 'output_invalid',
        })

        await expect(harness.analyze(input)).resolves.toEqual({ status: 'terminal' })
        expect(harness.mocks.analyzeReview).not.toHaveBeenCalled()
        expect(harness.mocks.advanceWithoutAnalysis).toHaveBeenCalledOnce()
      })

      // A charged attempt blocks every later attempt of the same operation at
      // admission. Retried, it came back `operation_ambiguous` three times in
      // seconds, which replaced the real code and made the review reopenable.
      it.each([
        'output_invalid',
        'output_truncated',
        'provider_refused',
        'completed_without_delivery',
      ] as const)(
        'ends the operation under its own code after a charged %s on the first attempt',
        async (code) => {
          const harness = await createHarness({
            providerError: { code, retryAfterEpochMillis: null },
          })

          await expect(harness.analyze(input)).resolves.toEqual({ status: 'terminal' })
          expect(harness.mocks.recordFailure).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
              expectedAttempt: 1,
              failureCode: code,
              retryAtEpochMillis: null,
            }),
          )
          expect(harness.mocks.advanceWithoutAnalysis).toHaveBeenCalledOnce()
        },
      )

      it('still retries an uncharged ambiguous outcome on the first attempt', async () => {
        const harness = await createHarness({
          providerError: { code: 'operation_ambiguous', retryAfterEpochMillis: null },
        })

        await expect(harness.analyze(input)).resolves.toEqual({
          status: 'retry',
          retryAtEpochMillis: NOW + 1_000,
          code: 'operation_ambiguous',
        })
      })

      it('terminal-settles a refusal on the last budgeted attempt', async () => {
        const harness = await createHarness({
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
      const harness = await createHarness()

      await expect(harness.analyze(input)).resolves.toEqual({
        status: 'retry',
        retryAtEpochMillis: NOW + 30_000,
        code: 'language_runtime_unavailable',
      })
      expect(harness.mocks.analyzeReview).not.toHaveBeenCalled()
      expect(harness.mocks.advanceWithoutAnalysis).not.toHaveBeenCalled()
      expect(harness.mocks.applyReviewAnalysis).not.toHaveBeenCalled()
    })

    it('keeps a drifted runtime runnable after the operation horizon', async () => {
      const harness = await createHarness()

      await expect(harness.analyze(elapsedInput)).resolves.toEqual({
        status: 'retry',
        retryAtEpochMillis: NOW + 30_000,
        code: 'language_runtime_unavailable',
      })
      expect(harness.mocks.analyzeReview).not.toHaveBeenCalled()
      expect(harness.mocks.claim).not.toHaveBeenCalled()
      expect(harness.mocks.advanceWithoutAnalysis).not.toHaveBeenCalled()
      expect(harness.mocks.applyReviewAnalysis).not.toHaveBeenCalled()

      withPinnedLanguageRuntime()
      await expect(harness.analyze(elapsedInput)).resolves.toEqual({
        status: 'completed',
      })
      expect(harness.mocks.analyzeReview).toHaveBeenCalledOnce()
      expect(harness.mocks.applyReviewAnalysis).toHaveBeenCalledOnce()
      expect(harness.mocks.advanceWithoutAnalysis).not.toHaveBeenCalled()
    })
  })

  describe('with an unavailable property processing profile', () => {
    it.each(['not_found', 'policy_unavailable'] as const)(
      'retries a %s profile instead of terminal-skipping the review',
      async (profileStatus) => {
        const harness = await createHarness({ profileStatus })

        await expect(harness.analyze(input)).resolves.toEqual({
          status: 'retry',
          retryAtEpochMillis: NOW + 30_000,
          code: `property_profile_${profileStatus}`,
        })
        expect(harness.mocks.advanceWithoutAnalysis).not.toHaveBeenCalled()
        expect(harness.mocks.applyReviewAnalysis).not.toHaveBeenCalled()
      },
    )

    it('terminal-settles a deleting owner immediately', async () => {
      const harness = await createHarness({ profileStatus: 'deleting' })

      await expect(harness.analyze(input)).resolves.toEqual({ status: 'terminal' })
      expect(harness.mocks.advanceWithoutAnalysis).toHaveBeenCalledWith(
        expect.objectContaining({
          dispositionCode: 'policy_disabled',
        }),
      )
    })

    it.each(['not_found', 'policy_unavailable'] as const)(
      'analyses after a %s profile is restored past the horizon',
      async (profileStatus) => {
        const harness = await createHarness({ profileStatus })
        const available = await createHarness()
        await expect(harness.analyze(elapsedInput)).resolves.toMatchObject({
          status: 'retry',
          code: `property_profile_${profileStatus}`,
        })
        expect(harness.mocks.advanceWithoutAnalysis).not.toHaveBeenCalled()
        harness.mocks.readProcessingProfile.mockResolvedValueOnce(
          await available.mocks.readProcessingProfile(),
        )
        await expect(harness.analyze(elapsedInput)).resolves.toEqual({
          status: 'completed',
        })
        expect(harness.mocks.analyzeReview).toHaveBeenCalledOnce()
      },
    )

    it('still terminal-settles a source lifecycle transition with no profile', async () => {
      const harness = await createHarness({ profileStatus: 'not_found' })

      await expect(
        harness.analyze({ ...input, disposition: 'provider_deleted' }),
      ).resolves.toEqual({ status: 'terminal' })
      expect(harness.mocks.advanceWithoutAnalysis).toHaveBeenCalledWith(
        expect.objectContaining({
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
        const harness = await createHarness({ authorization: 'absent' })

        await expect(harness.analyze({ ...input, disposition })).resolves.toEqual({
          status: 'replayed',
        })
        expect(harness.mocks.consumeNext).not.toHaveBeenCalled()
        expect(harness.mocks.advanceWithoutAnalysis).not.toHaveBeenCalled()
        expect(harness.mocks.applyReviewAnalysis).not.toHaveBeenCalled()
        expect(harness.mocks.analyzeReview).not.toHaveBeenCalled()
      },
    )
  })
})
