import { describe, expect, it, vi } from 'vitest'
import { AI_ROUTE_OUTPUT_JSON_SCHEMAS } from '#/shared/ai-route-output-schemas'
import { REVIEW_ANALYSIS_V3_DEVELOPER_PROMPT } from '#/shared/review-analysis-v3-prompt'
import { buildReviewAnalysisV3ProviderPayload } from '#/shared/review-analysis-v3-request'
import { resolveReviewPropertyContext } from '#/shared/review-vocabulary-hints'
import {
  acceptEvaluationAnswer,
  prepareEvaluationItem,
  runProvider,
  type EvaluationOutcome,
  type EvaluationProvider,
  type PreparedEvaluationItem,
} from './review-analysis-v3-provider'
import { item } from './review-analysis-v3.test-fixtures'

const GOOD_ANSWER = {
  sentiment: 'negative',
  mentions: [
    {
      topic: 'facilities_equipment',
      polarity: 'negative',
      strength: 'clear',
      thing: 'air conditioning',
      issue: 'not working',
      sentences: [1],
      names_person: null,
    },
  ],
  urgent: null,
}

function prepared(): Extract<PreparedEvaluationItem, { status: 'prepared' }> {
  const one = prepareEvaluationItem(item())
  if (one.status !== 'prepared') throw new Error('the test item should be prepared')
  return one
}

function providerOf(analyze: EvaluationProvider['analyze']): EvaluationProvider {
  return { id: 'test', model: 'test-model', analyze }
}

describe('prepareEvaluationItem', () => {
  it('asks the production question: the prompt, the schema, the hints and the numbered sentences', () => {
    const one = prepared()

    expect(one.itemId).toBe('cx-0001')
    expect(one.request.developerPrompt).toBe(REVIEW_ANALYSIS_V3_DEVELOPER_PROMPT)
    expect(one.request.answerSchema).toBe(
      AI_ROUTE_OUTPUT_JSON_SCHEMAS['review-analysis-v3'],
    )
    expect(one.request.payload).toEqual(
      buildReviewAnalysisV3ProviderPayload({
        rating: 2,
        languageCode: 'en',
        propertyContext: resolveReviewPropertyContext('Hotel').propertyContext,
        sentences: ['The air conditioning did not work.'],
      }),
    )
  })

  it('chooses the hints from the business, as the live path does from the Google category', () => {
    const hotel = prepared().request.payload.propertyContext
    const spa = prepareEvaluationItem(item({ business: 'Day spa' }))

    expect(hotel.vocabularyHintSetId).toBe('lodging')
    expect(
      spa.status === 'prepared' &&
        spa.request.payload.propertyContext.vocabularyHintSetId,
    ).toBe('spa-wellness')
  })

  it('redacts contact details before the provider can read them', () => {
    const text = 'Write to me at jane.doe@example.com about the lift.'
    const one = prepareEvaluationItem(item({ text, sentences: [text] }))

    expect(one.status).toBe('prepared')
    if (one.status !== 'prepared') return
    expect(JSON.stringify(one.request.payload)).not.toContain('@')
    expect(one.evidence.redactedSentences.join(' ')).toContain('[CONTACT]')
  })

  it('names a mixed-language review undetermined', () => {
    const one = prepareEvaluationItem(item({ language: 'mixed' }))

    expect(one.status === 'prepared' && one.request.payload.languageCode).toBe('und')
  })

  it('normalizes the text as the Review context does before anything is redacted', () => {
    const text = 'Lovely boat… but we left late.'
    const one = prepareEvaluationItem(
      item({ text, sentences: ['Lovely boat…', 'but we left late.'] }),
    )

    expect(one.status).toBe('prepared')
    if (one.status !== 'prepared') return
    // NFKC turns the ellipsis into three full stops; the redactor reads only canonical text.
    expect(one.evidence.redactedSentences).toEqual([
      'Lovely boat...',
      'but we left late.',
    ])
    expect(one.request.payload.sentences).toEqual([
      { number: 1, text: 'Lovely boat...' },
      { number: 2, text: 'but we left late.' },
    ])
  })

  it('neutralizes a placeholder the guest typed, so a review cannot forge a marker', () => {
    const text = 'My [CONTACT] was shared.'
    const one = prepareEvaluationItem(item({ text, sentences: [text] }))

    expect(one.status).toBe('prepared')
    if (one.status !== 'prepared') return
    expect(JSON.stringify(one.request.payload.sentences)).not.toContain('[CONTACT]')
  })

  it('does not prepare a review whose source the canonicalizer refuses', () => {
    const text = 'Broken \ud800 text.'
    const one = prepareEvaluationItem(item({ text, sentences: [text] }))

    expect(one).toEqual({
      status: 'redaction_blocked',
      itemId: 'cx-0001',
      reason: 'source_refused',
    })
  })

  it('does not prepare a review the redactor refuses', () => {
    const text = 'jane.doe@example.com john.roe@example.org'
    const one = prepareEvaluationItem(item({ text, sentences: [text] }))

    expect(one).toEqual({
      status: 'redaction_blocked',
      itemId: 'cx-0001',
      reason: 'redaction_ratio_exceeded',
    })
  })
})

describe('acceptEvaluationAnswer', () => {
  it('accepts an answer through the production normalizer and reports its repairs', () => {
    const accepted = acceptEvaluationAnswer(
      { ...GOOD_ANSWER, sentiment: 'NEGATIVE' },
      prepared().evidence,
    )

    expect(accepted?.answer.sentiment).toBe('negative')
    expect(accepted?.flags).toContain('enum_case_repaired')
    expect(accepted?.droppedMentionCount).toBe(0)
  })

  it('refuses an answer with no usable top level', () => {
    expect(acceptEvaluationAnswer('not an object', prepared().evidence)).toBeNull()
    expect(acceptEvaluationAnswer({ mentions: [] }, prepared().evidence)).toBeNull()
  })
})

describe('runProvider', () => {
  it('turns an answer into the final normalized label and keeps the usage', async () => {
    const provider = providerOf(async () => ({
      status: 'answered',
      answer: GOOD_ANSWER,
      latencyMillis: 120,
      usage: { inputTokens: 900, outputTokens: 70 },
    }))

    const [result] = await runProvider(provider, [prepared()])

    expect(result).toMatchObject({
      itemId: 'cx-0001',
      status: 'accepted',
      latencyMillis: 120,
      usage: { inputTokens: 900, outputTokens: 70 },
      droppedMentionCount: 0,
    })
    expect(result?.answer?.mentions).toHaveLength(1)
  })

  it('counts an answer the normalizer cannot use as invalid, not as a crash', async () => {
    const provider = providerOf(async () => ({ status: 'answered', answer: 'nonsense' }))

    const [result] = await runProvider(provider, [prepared()])

    expect(result).toMatchObject({ status: 'output_invalid', answer: null })
  })

  it.each(['refused', 'truncated', 'failed'] as const)(
    'records a %s call with no label',
    async (status) => {
      const provider = providerOf(async (): Promise<EvaluationOutcome> => ({
        status,
        usage: { inputTokens: 5, outputTokens: 1 },
      }))

      const [result] = await runProvider(provider, [prepared()])

      expect(result).toMatchObject({ status, answer: null, usage: { inputTokens: 5 } })
    },
  )

  it('counts a provider that throws as a failed call and keeps its message out of the result', async () => {
    const provider = providerOf(async () => {
      throw new Error('key sk-secret-123 was rejected')
    })

    const [result] = await runProvider(provider, [prepared()])

    expect(result?.status).toBe('failed')
    expect(JSON.stringify(result)).not.toContain('sk-secret')
  })

  it('never sends a review the redactor refused', async () => {
    const analyze = vi.fn(async (): Promise<EvaluationOutcome> => ({ status: 'failed' }))
    const contactsOnly = 'jane.doe@example.com john.roe@example.org'
    const blocked = prepareEvaluationItem(
      item({ id: 'cx-0002', text: contactsOnly, sentences: [contactsOnly] }),
    )
    expect(blocked.status).toBe('redaction_blocked')

    const results = await runProvider(providerOf(analyze), [blocked, prepared()])

    expect(analyze).toHaveBeenCalledTimes(1)
    expect(results.map((result) => [result.itemId, result.status])).toEqual([
      ['cx-0002', 'redaction_blocked'],
      ['cx-0001', 'failed'],
    ])
  })

  it('times the call itself when the provider does not', async () => {
    const clock = [1_000, 1_250]
    const provider = providerOf(async () => ({ status: 'answered', answer: GOOD_ANSWER }))

    const [result] = await runProvider(provider, [prepared()], {
      now: () => clock.shift() ?? 0,
    })

    expect(result?.latencyMillis).toBe(250)
  })

  it('answers every review once, in order', async () => {
    const seen: string[] = []
    const provider = providerOf(async (request) => {
      seen.push(request.itemId)
      return { status: 'answered', answer: GOOD_ANSWER }
    })
    const second = prepareEvaluationItem(item({ id: 'cx-0002' }))

    const results = await runProvider(provider, [prepared(), second])

    expect(seen).toEqual(['cx-0001', 'cx-0002'])
    expect(results.map((result) => result.itemId)).toEqual(['cx-0001', 'cx-0002'])
  })
})
