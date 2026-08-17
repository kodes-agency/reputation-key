import { afterEach, describe, expect, it } from 'vitest'
import { startAiProviderStub, type AiProviderStubHandle } from './ai-provider-stub'

let handle: AiProviderStubHandle | undefined
afterEach(async () => {
  await handle?.stop()
  handle = undefined
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
      body: JSON.stringify(providerRequest('reply_template_selection_v1')),
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
})
