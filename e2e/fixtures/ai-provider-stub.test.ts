import { afterEach, describe, expect, it } from 'vitest'
import { startAiProviderStub, type AiProviderStubHandle } from './ai-provider-stub'
import { parsePersonalizedReplyDraft } from '../../src/shared/ai-personalized-reply-contract'
import {
  AI_ANALYSIS_V2_OUTPUT_SCHEMA,
  AI_TREND_SELECTION_OUTPUT_SCHEMA,
} from '../../src/shared/ai-route-output-schemas'

let handle: AiProviderStubHandle | undefined
const originalUnscriptedMode = process.env.AI_PROVIDER_STUB_UNSCRIPTED
afterEach(async () => {
  await handle?.stop()
  handle = undefined
  if (originalUnscriptedMode === undefined) delete process.env.AI_PROVIDER_STUB_UNSCRIPTED
  else process.env.AI_PROVIDER_STUB_UNSCRIPTED = originalUnscriptedMode
})

async function arm(value: unknown): Promise<Response> {
  return fetch(`${handle?.baseUrl}/__control/arm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  })
}

function providerRequest(name: string): Readonly<Record<string, unknown>> {
  return {
    model: 'gpt-5.4-mini-2026-03-17',
    text: { format: { type: 'json_schema', name } },
  }
}

function anthropicRequest(rating = 5): Readonly<Record<string, unknown>> {
  return {
    model: 'claude-haiku-5-5',
    max_tokens: 8192,
    system: 'Synthetic developer prompt.',
    messages: [
      {
        role: 'user',
        content: JSON.stringify({ reviewText: 'Invented review.', rating }),
      },
    ],
    metadata: { user_id: `rk1_${'a'.repeat(43)}` },
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'medium',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: { sentiment: {}, mentions: {}, urgent: {} },
          required: ['sentiment', 'mentions', 'urgent'],
          additionalProperties: false,
        },
      },
    },
  }
}

const anthropicHeaders = Object.freeze({
  accept: 'application/json',
  'anthropic-version': '2026-10-21',
  'content-type': 'application/json',
  'user-agent': 'repkey-ai-egress-gateway/1.0',
  'x-api-key': 'synthetic-local-key',
})

describe('AI Responses provider stub', () => {
  it('serves one ordered scripted response without recording provider input', async () => {
    handle = await startAiProviderStub(0)
    expect(
      (
        await arm({
          operationKind: 'reply',
          parsed: { templateId: 'appreciation_positive', languageCode: 'en-Latn' },
        })
      ).status,
    ).toBe(201)

    const provider = await fetch(`${handle.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(providerRequest('reply_draft_v1')),
    })
    expect(provider.status).toBe(200)
    const body = (await provider.json()) as {
      output: readonly Readonly<{ content: readonly Readonly<{ text: string }>[] }>[]
    }
    expect(JSON.parse(body.output[0]?.content[0]?.text ?? '')).toEqual({
      templateId: 'appreciation_positive',
      languageCode: 'en-Latn',
    })

    const recorded = await fetch(`${handle.baseUrl}/__control/calls`).then(
      async (response) => response.json(),
    )
    expect(recorded).toEqual([
      { ordinal: 1, operationKind: 'reply', outcome: 'response', status: 200 },
    ])
    expect(JSON.stringify(recorded)).not.toContain('appreciation_positive')
  })

  it('returns a code-only failure when an operation is unscripted', async () => {
    handle = await startAiProviderStub(0)
    const response = await fetch(`${handle.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(providerRequest('property_trend_v1')),
    })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'unscripted' })
  })

  it('rejects unknown script fields and inconsistent usage', async () => {
    handle = await startAiProviderStub(0)
    expect(
      (await arm({ operationKind: 'analysis', parsed: {}, extra: true })).status,
    ).toBe(400)
    expect(
      (
        await arm({
          operationKind: 'analysis',
          parsed: {},
          usage: { inputTokens: 1, cachedTokens: 2, outputTokens: 1, reasoningTokens: 0 },
        })
      ).status,
    ).toBe(400)
  })

  describe('AI_PROVIDER_STUB_UNSCRIPTED=respond (the local inner loop)', () => {
    const previous = process.env.AI_PROVIDER_STUB_UNSCRIPTED
    afterEach(() => {
      if (previous === undefined) delete process.env.AI_PROVIDER_STUB_UNSCRIPTED
      else process.env.AI_PROVIDER_STUB_UNSCRIPTED = previous
    })

    async function unscripted(name: string, payload: Record<string, unknown>) {
      process.env.AI_PROVIDER_STUB_UNSCRIPTED = 'respond'
      handle = await startAiProviderStub(0)
      const response = await fetch(`${handle.baseUrl}/v1/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...providerRequest(name),
          input: [
            { role: 'developer', content: 'prompt' },
            { role: 'user', content: JSON.stringify(payload) },
          ],
        }),
      })
      const body = (await response.json()) as {
        output?: readonly Readonly<{ content: readonly Readonly<{ text: string }>[] }>[]
      }
      return {
        status: response.status,
        parsed: JSON.parse(body.output?.[0]?.content[0]?.text ?? 'null') as unknown,
      }
    }

    it('answers an unscripted analysis with output the app accepts, keyed by rating', async () => {
      const low = await unscripted('review_analysis_v2', {
        reviewText: 'Cold food.',
        rating: 1,
      })
      expect(low.status).toBe(200)
      expect(AI_ANALYSIS_V2_OUTPUT_SCHEMA.safeParse(low.parsed).success).toBe(true)
      expect((low.parsed as { sentiment: string }).sentiment).toBe('negative')
    })

    it('answers an unscripted reply draft that passes the grounding and brand contract', async () => {
      // Codes, digits and punctuation in the review must not be quoted back:
      // the app's leakage scanner reads them as identifiers.
      const reviewText =
        'Room 12B, booking REF-4471: a decent stay overall, but the check-in queue at Seaside Inn was long.'
      const result = await unscripted('reply_draft_v1', {
        propertyDisplayName: 'Seaside Inn',
        reviewText,
        rating: 5,
        languageCode: 'en-Latn',
        tone: 'friendly',
      })
      expect(result.status).toBe(200)
      expect(
        parsePersonalizedReplyDraft({
          output: result.parsed,
          reviewText,
          rating: 5,
          tone: 'friendly',
          brandDisplayName: 'Seaside Inn',
          targetLanguageTag: 'en-Latn',
          countryCode: 'BG',
        }).status,
      ).toBe('accepted')
    })

    it('answers an unscripted trend selection the app accepts', async () => {
      const result = await unscripted('property_trend_v1', {})
      expect(result.status).toBe(200)
      expect(AI_TREND_SELECTION_OUTPUT_SCHEMA.safeParse(result.parsed).success).toBe(true)
    })

    it('still refuses when the reply payload cannot ground a draft', async () => {
      const result = await unscripted('reply_draft_v1', {
        propertyDisplayName: 'Seaside Inn',
        reviewText: '',
      })
      expect(result.status).toBe(503)
    })
  })
})

describe('Anthropic Messages provider stub', () => {
  it('serves a scripted Messages response and preserves the shared call log', async () => {
    handle = await startAiProviderStub(0)
    expect(
      (
        await arm({
          operationKind: 'analysis',
          parsed: { sentiment: 'mixed', mentions: [], urgent: null },
        })
      ).status,
    ).toBe(201)

    const response = await fetch(`${handle.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: anthropicHeaders,
      body: JSON.stringify(anthropicRequest()),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      stop_reason: string
      content: readonly Readonly<{ text: string }>[]
    }
    expect(body.stop_reason).toBe('end_turn')
    expect(JSON.parse(body.content[0]?.text ?? '')).toEqual({
      sentiment: 'mixed',
      mentions: [],
      urgent: null,
    })
    expect(
      await fetch(`${handle.baseUrl}/__control/calls`).then(async (value) =>
        value.json(),
      ),
    ).toEqual([
      { ordinal: 1, operationKind: 'analysis', outcome: 'response', status: 200 },
    ])
  })

  it('synthesizes the v3 analysis shape from the request rating', async () => {
    process.env.AI_PROVIDER_STUB_UNSCRIPTED = 'respond'
    handle = await startAiProviderStub(0)
    const response = await fetch(`${handle.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: anthropicHeaders,
      body: JSON.stringify(anthropicRequest(2)),
    })
    const body = (await response.json()) as {
      content?: readonly Readonly<{ text: string }>[]
    }
    expect(response.status).toBe(200)
    expect(JSON.parse(body.content?.[0]?.text ?? 'null')).toEqual({
      sentiment: 'negative',
      mentions: [],
      urgent: null,
    })
  })

  it('returns an Anthropic error body with the scripted retry delay', async () => {
    handle = await startAiProviderStub(0)
    expect(
      (
        await arm({
          operationKind: 'analysis',
          status: 529,
          retryAfterSeconds: 4,
        })
      ).status,
    ).toBe(201)
    const response = await fetch(`${handle.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: anthropicHeaders,
      body: JSON.stringify(anthropicRequest()),
    })
    expect(response.status).toBe(529)
    expect(response.headers.get('retry-after')).toBe('4')
    expect(await response.json()).toEqual({
      type: 'error',
      error: { type: 'overloaded_error', message: 'Synthetic overloaded_error' },
      request_id: 'synthetic-anthropic-request-id',
    })
  })
})
