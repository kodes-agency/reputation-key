import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OPENAI_RESPONSES_URL, OPENAI_USER_AGENT } from './contracts'

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))
vi.mock('undici', () => ({ request: requestMock }))

import { createLocalAiProviderFetch } from './local-provider-transport'

function headers(): Headers {
  return new Headers({
    accept: 'application/json',
    authorization: 'Bearer local-test-key',
    'content-type': 'application/json',
    'user-agent': OPENAI_USER_AGENT,
    'x-client-request-id': `rk_ai_${'A'.repeat(43)}`,
  })
}

function responseBody(bytes: Uint8Array): Readonly<{
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array>
  destroy(): void
}> {
  let sent = false
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          if (sent) return { done: true, value: undefined }
          sent = true
          return { done: false, value: bytes }
        },
      }
    },
    destroy() {},
  }
}

describe('local AI provider transport', () => {
  beforeEach(() => {
    requestMock.mockReset()
  })

  it('maps only the compiled logical OpenAI request to the compile-time local stub and clears its owned body', async () => {
    let requestBody: Buffer | undefined
    let observedBody: Buffer | undefined
    requestMock.mockImplementation(async (_url, options) => {
      requestBody = options.body
      observedBody = Buffer.from(options.body)
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: responseBody(Buffer.from('{"ok":true}', 'utf8')),
      }
    })
    process.env.AI_PROVIDER_STUB_ORIGIN = 'http://attacker.invalid:9999'
    const callerOwned = Buffer.from('{"reviewText":"private source"}', 'utf8')
    const callerSnapshot = Buffer.from(callerOwned)

    const response = await createLocalAiProviderFetch()(OPENAI_RESPONSES_URL, {
      method: 'POST',
      redirect: 'manual',
      headers: headers(),
      body: callerOwned,
    })

    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(requestMock.mock.calls[0]?.[0]).toBe(
      'http://ai-provider-stub:4102/v1/responses',
    )
    expect(observedBody).toEqual(callerSnapshot)
    expect(requestBody).toBeDefined()
    expect(requestBody).not.toBe(callerOwned)
    expect([...requestBody!]).toEqual(new Array(requestBody!.byteLength).fill(0))
    expect(callerOwned).toEqual(callerSnapshot)
    expect(await response.json()).toEqual({ ok: true })
    delete process.env.AI_PROVIDER_STUB_ORIGIN
  })

  it.each([
    [`${OPENAI_RESPONSES_URL}?next=https://attacker.invalid`, 'POST'],
    [OPENAI_RESPONSES_URL, 'GET'],
    ['https://attacker.invalid/v1/responses', 'POST'],
  ])(
    'rejects non-exact logical destination or method before transport',
    async (url, method) => {
      await expect(
        createLocalAiProviderFetch()(url, {
          method,
          redirect: 'manual',
          headers: headers(),
          body: '{}',
        }),
      ).rejects.toThrow(/destination is invalid/)
      expect(requestMock).not.toHaveBeenCalled()
    },
  )

  it('destroys the source stream when response iteration fails', async () => {
    const destroy = vi.fn()
    requestMock.mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: {
        [Symbol.asyncIterator]() {
          return {
            next: async () => {
              throw new Error('stream failed')
            },
            return: async () => ({ done: true, value: undefined }),
          }
        },
        destroy,
      },
    })
    const response = await createLocalAiProviderFetch()(OPENAI_RESPONSES_URL, {
      method: 'POST',
      redirect: 'manual',
      headers: headers(),
      body: '{}',
    })
    await expect(response.arrayBuffer()).rejects.toThrow()
    expect(destroy).toHaveBeenCalledTimes(1)
  })
})
