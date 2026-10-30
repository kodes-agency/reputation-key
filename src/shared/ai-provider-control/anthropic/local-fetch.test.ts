import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { request as undiciRequest } from 'undici'
import { createLocalAnthropicProviderFetch } from './local-fetch'
import { ANTHROPIC_MESSAGES_URL, ANTHROPIC_USER_AGENT } from './request-profile'

vi.mock('undici', async (importOriginal) => {
  const original = await importOriginal<typeof import('undici')>()
  return { ...original, request: vi.fn() }
})

const requestMock = vi.mocked(undiciRequest)

function headers(extra: Record<string, string> = {}) {
  return {
    accept: 'application/json',
    'anthropic-version': '2026-10-21',
    'content-type': 'application/json',
    'user-agent': ANTHROPIC_USER_AGENT,
    'x-api-key': 'invented-key',
    ...extra,
  }
}

beforeEach(() => requestMock.mockReset())

describe('local Anthropic provider fetch', () => {
  it('forwards exact body bytes to the one compiled stub destination', async () => {
    let forwardedBody = Buffer.alloc(0)
    requestMock.mockImplementation((async (...args: unknown[]) => {
      const options = (args[1] ?? args[0]) as Readonly<{ body?: unknown }> | undefined
      if (options?.body instanceof Uint8Array) {
        forwardedBody = Buffer.from(options.body)
      }
      return {
        statusCode: 200,
        headers: {
          'content-type': 'application/json',
          'retry-after': '7',
          'x-poison': 'discarded',
        },
        body: Readable.from([Buffer.from('{"invented":true}')]),
      } as never
    }) as typeof undiciRequest)
    const body = Buffer.from('{"request":"invented"}')
    const response = await createLocalAnthropicProviderFetch()(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      redirect: 'manual',
      headers: headers(),
      body,
    })
    expect(requestMock).toHaveBeenCalledWith(
      'http://ai-provider-stub:4102/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: headers(),
      }),
    )
    expect(forwardedBody).toEqual(Buffer.from('{"request":"invented"}'))
    expect(await response.json()).toEqual({ invented: true })
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('retry-after')).toBe('7')
    expect(response.headers.get('x-poison')).toBeNull()
    expect(body).toEqual(Buffer.from('{"request":"invented"}'))
  })

  it('refuses changed destinations and header sets before forwarding', async () => {
    const local = createLocalAnthropicProviderFetch()
    await expect(
      local('https://elsewhere.invalid/v1/messages', {
        method: 'POST',
        redirect: 'manual',
        headers: headers(),
        body: '{}',
      }),
    ).rejects.toThrow(new TypeError('Local Anthropic provider destination is invalid'))
    await expect(
      local(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        redirect: 'manual',
        headers: headers({ extra: 'refused' }),
        body: '{}',
      }),
    ).rejects.toThrow(
      new TypeError('Local Anthropic provider request headers are invalid'),
    )
    expect(requestMock).not.toHaveBeenCalled()
  })
})
