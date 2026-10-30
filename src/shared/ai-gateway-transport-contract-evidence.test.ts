import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod/v4'
import {
  parseAiGatewayRouteRequest,
  parseAiGatewayRouteResponse,
} from './ai-gateway-transport-contract'
import {
  analysisRequest,
  analysisV3Request,
  receipt,
  replyRequest,
  v2FormAnalysisRequest,
} from './ai-gateway-transport-contract.test-fixtures'
import { MAX_AI_REVIEW_SENTENCES_V1 } from './ai-review-source-contract'
import {
  REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
  REVIEW_ANALYSIS_NORMALIZATION_VERSION,
} from './review-analysis-v3-normalizer'
import { REVIEW_ANALYSIS_V3_OPERATION_PROFILE } from './review-analysis-v3-request'
import { resolveReviewPropertyContext } from './review-vocabulary-hints'

const CROSS_WIRED = 'route binding is cross-wired'

/** Every issue the strict request schema raises for a value, as messages. */
function issuesOf(value: unknown): readonly string[] {
  try {
    parseAiGatewayRouteRequest(value)
    return []
  } catch (error) {
    if (!(error instanceof ZodError)) throw error
    return error.issues.map((issue) => issue.message)
  }
}

describe('review-analysis v3 evidence request', () => {
  it('is what the live catalogue serves for review analysis, and nothing is wrong with it', () => {
    // The sentences, the property context, the provider and their agreement with the
    // text are all valid, and the binding is the catalogue's.
    expect(issuesOf(analysisV3Request())).toEqual([])
    expect(issuesOf(analysisRequest())).toEqual([])
  })

  it('keeps the v3 profile name in step with the version set', () => {
    expect(REVIEW_ANALYSIS_V3_OPERATION_PROFILE).toBe('review-analysis-v3')
    expect(analysisV3Request().binding.operationProfileVersion).toBe(
      REVIEW_ANALYSIS_V3_OPERATION_PROFILE,
    )
  })

  describe('the retired v2 form', () => {
    it('is refused as cross-wired: the live catalogue serves review analysis as v3', () => {
      expect(issuesOf(v2FormAnalysisRequest())).toEqual([CROSS_WIRED])
    })

    it('has no sentences and no property context', () => {
      const v2 = v2FormAnalysisRequest()
      expect(v2.source.sentences).toBeUndefined()
      expect(v2.propertyContext).toBeUndefined()
      expect(v2.provider).toBeUndefined()
    })

    it('refuses a v2 request that carries sentences', () => {
      const v3 = analysisV3Request()
      const v2 = v2FormAnalysisRequest()
      expect(
        issuesOf({ ...v2, source: { ...v2.source, sentences: v3.source.sentences } }),
      ).toContain('analysis v2 route forbids an evidence request')
    })

    it('refuses a v2 request that names a provider', () => {
      expect(
        issuesOf({ ...v2FormAnalysisRequest(), provider: analysisV3Request().provider }),
      ).toContain('analysis v2 route forbids an evidence request')
    })

    it('refuses a v2 request that carries a property context', () => {
      expect(
        issuesOf({
          ...v2FormAnalysisRequest(),
          propertyContext: analysisV3Request().propertyContext,
        }),
      ).toContain('analysis v2 route forbids an evidence request')
    })

    it('refuses sentences on the reply route, which reads no evidence', () => {
      const reply = replyRequest()
      expect(() =>
        parseAiGatewayRouteRequest({
          ...reply,
          source: { ...reply.source, sentences: analysisV3Request().source.sentences },
        }),
      ).toThrow(ZodError)
    })
  })

  describe('v3 evidence', () => {
    it('requires the numbered sentences, the property context and the provider together', () => {
      const request = analysisV3Request()
      const { sentences: _sentences, ...sourceWithoutSentences } = request.source
      const { propertyContext: _context, ...requestWithoutContext } = request
      const { provider: _provider, ...requestWithoutProvider } = request

      expect(issuesOf({ ...request, source: sourceWithoutSentences })).toContain(
        'analysis v3 route requires numbered sentences, a property context and a provider',
      )
      expect(issuesOf(requestWithoutContext)).toContain(
        'analysis v3 route requires numbered sentences, a property context and a provider',
      )
      expect(issuesOf(requestWithoutProvider)).toContain(
        'analysis v3 route requires numbered sentences, a property context and a provider',
      )
    })

    it('takes the claimed provider as an identity of the closed set and nothing looser', () => {
      const request = analysisV3Request()
      const provider = request.provider!

      expect(provider).toMatchObject({ id: 'openai', model: 'gpt-6-luna' })
      for (const wrong of [
        { ...provider, id: 'google' },
        { ...provider, id: 'OpenAI' },
        { ...provider, model: '' },
        { ...provider, requestProfileDigest: 'F'.repeat(64) },
        { ...provider, requestProfileDigest: 'a'.repeat(63) },
        { ...provider, extra: true },
      ]) {
        expect(issuesOf({ ...request, provider: wrong }).length).toBeGreaterThan(0)
        expect(issuesOf({ ...request, provider: wrong })).not.toEqual([CROSS_WIRED])
      }
    })

    it('requires sentence n to stand at index n - 1', () => {
      const request = analysisV3Request()
      const sentences = request.source.sentences!
      const shuffled = [sentences[1]!, sentences[0]!, ...sentences.slice(2)]
      const skipped = sentences.map((sentence, index) => ({
        ...sentence,
        number: index + 2,
      }))

      for (const wrong of [shuffled, skipped]) {
        expect(
          issuesOf({ ...request, source: { ...request.source, sentences: wrong } }),
        ).toContain('analysis v3 sentences are not the review text, numbered from one')
      }
    })

    it('requires the sentences to be the text it carries', () => {
      const request = analysisV3Request()
      const sentences = request.source.sentences!
      const other = [
        { ...sentences[0]!, text: 'A different sentence entirely.' },
        ...sentences.slice(1),
      ]
      const missing = sentences.slice(0, -1)

      for (const wrong of [other, missing, []]) {
        expect(
          issuesOf({ ...request, source: { ...request.source, sentences: wrong } }),
        ).toContain('analysis v3 sentences are not the review text, numbered from one')
      }
    })

    it('allows what the text allows: line breaks flattened, names masked in each sentence', () => {
      const request = analysisV3Request({
        rawText: 'We asked Dr. Smith.\nHe was kind.',
        reviewerDisplayName: 'Dr. Smith',
      })

      expect(request.source.text).toBe('We asked [PERSON]. He was kind.')
      expect(request.source.sentences?.map((sentence) => sentence.text)).toEqual([
        'We asked [PERSON]',
        '[PERSON].',
        'He was kind.',
      ])
      expect(issuesOf(request)).toEqual([])
    })

    it('keeps an empty sentence and its number', () => {
      const request = analysisV3Request({ rawText: 'First.\n\u0007\nThird.' })

      expect(request.source.sentences).toEqual([
        { number: 1, text: 'First.' },
        { number: 2, text: '' },
        { number: 3, text: 'Third.' },
      ])
      expect(issuesOf(request)).toEqual([])
    })

    it('bounds the sentences at the evidence limit', () => {
      const request = analysisV3Request()
      const many = Array.from({ length: MAX_AI_REVIEW_SENTENCES_V1 + 1 }, (_, index) => ({
        number: index + 1,
        text: 'a.',
      }))

      expect(() =>
        parseAiGatewayRouteRequest({
          ...request,
          source: { ...request.source, sentences: many },
        }),
      ).toThrow(ZodError)
    })

    it('refuses sentences with an unpaired surrogate or a NUL, like the text', () => {
      const request = analysisV3Request()
      for (const text of ['bad \ud800', 'bad \u0000 byte']) {
        expect(() =>
          parseAiGatewayRouteRequest({
            ...request,
            source: {
              ...request.source,
              sentences: [{ number: 1, text }],
            },
          }),
        ).toThrow(ZodError)
      }
    })

    it('takes the property context from the catalogue and nowhere else', () => {
      const request = analysisV3Request()
      const context = request.propertyContext!
      const edited = {
        ...context,
        vocabularyHints: { ...context.vocabularyHints, staff_service: ['injected hint'] },
      }
      const otherCategory = {
        ...resolveReviewPropertyContext('Hotel').propertyContext,
        googlePrimaryCategory: 'Barber shop',
      }

      for (const wrong of [edited, otherCategory]) {
        expect(issuesOf({ ...request, propertyContext: wrong })).toContain(
          'analysis v3 property context is not the catalogue hint set for its category',
        )
      }
    })

    it('accepts a Property with no category, which gets the generic hints', () => {
      const request = analysisV3Request({ googlePrimaryCategory: null })

      expect(request.propertyContext?.googlePrimaryCategory).toBeNull()
      expect(request.propertyContext?.vocabularyHintSetId).toBe('generic-service')
      expect(issuesOf(request)).toEqual([])
    })

    it('refuses unknown keys in the context and in a sentence', () => {
      const request = analysisV3Request()
      expect(
        issuesOf({
          ...request,
          propertyContext: { ...request.propertyContext, extra: 1 },
        }).length,
      ).toBeGreaterThan(0)
      expect(
        issuesOf({
          ...request,
          source: {
            ...request.source,
            sentences: request.source.sentences!.map((sentence) => ({
              ...sentence,
              extra: 1,
            })),
          },
        }).length,
      ).toBeGreaterThan(0)
    })
  })

  describe('response', () => {
    const answer = {
      sentiment: 'negative',
      mentions: [
        {
          topic: 'speed_waiting',
          polarity: 'negative',
          strength: 'clear',
          thing: 'check-in',
          issue: 'slow',
          sentences: [2],
          names_person: null,
        },
      ],
      urgent: null,
    } as const
    const v3Result = {
      contract: 'review-analysis-v3',
      answer,
      normalization: {
        version: REVIEW_ANALYSIS_NORMALIZATION_VERSION,
        digest: REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
        flags: ['sentence_refs_repaired'],
        droppedMentionCount: 1,
      },
    } as const
    const v2Result = {
      sentiment: 'positive',
      sentimentValence: 80,
      urgencySignals: [],
      aspects: [{ aspect: 'service', polarity: 'positive', intensity: 80 }],
      issueLabel: null,
    } as const

    function success(result: unknown) {
      return {
        route: 'review-analysis',
        status: 'success',
        result,
        settlementReceipt: receipt,
      }
    }

    it('still parses a v2 answer, which is the only one served', () => {
      expect(parseAiGatewayRouteResponse(success(v2Result))).toMatchObject({
        status: 'success',
        result: v2Result,
      })
    })

    it('parses a v3 answer: the normalized answer and what normalizing it did', () => {
      expect(parseAiGatewayRouteResponse(success(v3Result))).toMatchObject({
        status: 'success',
        result: v3Result,
      })
    })

    it('does not take one answer for the other', () => {
      expect(() =>
        parseAiGatewayRouteResponse(
          success({ ...v2Result, contract: 'review-analysis-v3' }),
        ),
      ).toThrow(ZodError)
      expect(() =>
        parseAiGatewayRouteResponse(
          success({ contract: 'review-analysis-v3', ...v2Result }),
        ),
      ).toThrow(ZodError)
      expect(() =>
        parseAiGatewayRouteResponse(success({ ...v3Result, answer: v2Result })),
      ).toThrow(ZodError)
    })

    it('refuses an answer that breaks the stored contract, a flag it does not know or a repeated one', () => {
      const wrong = [
        { ...v3Result, answer: { ...answer, sentiment: 'furious' } },
        {
          ...v3Result,
          answer: { ...answer, mentions: [{ ...answer.mentions[0], sentences: [0] }] },
        },
        {
          ...v3Result,
          normalization: { ...v3Result.normalization, flags: ['invented_flag'] },
        },
        {
          ...v3Result,
          normalization: {
            ...v3Result.normalization,
            flags: ['sentence_refs_repaired', 'sentence_refs_repaired'],
          },
        },
        {
          ...v3Result,
          normalization: { ...v3Result.normalization, digest: 'f'.repeat(64) },
        },
        {
          ...v3Result,
          normalization: { ...v3Result.normalization, droppedMentionCount: 49 },
        },
      ]
      for (const result of wrong) {
        expect(() => parseAiGatewayRouteResponse(success(result))).toThrow(ZodError)
      }
    })

    it('carries no provider text beyond the stored contract', () => {
      expect(() =>
        parseAiGatewayRouteResponse(
          success({ ...v3Result, providerAnswer: { raw: 'text' } }),
        ),
      ).toThrow(ZodError)
    })
  })
})
