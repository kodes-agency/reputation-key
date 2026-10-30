import { describe, expect, it, vi } from 'vitest'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'
import {
  AmbiguousAnthropicTransportError,
  InvalidAnthropicOutputError,
  InvalidAnthropicRequestError,
  createOneShotAnthropicFetch,
  expectedPinnedAnthropicSdkHeaders,
} from './one-shot-fetch'
import { buildClosedAnthropicRequest } from './request-builder'
import { ANTHROPIC_MESSAGES_URL, ANTHROPIC_USER_AGENT } from './request-profile'

const request = buildClosedAnthropicRequest({
  developerPrompt: 'Classify invented data.',
  untrustedData: '{"invented":true}',
  wireSchema: {
    type: 'object',
    properties: { ok: { type: 'boolean' } },
    required: ['ok'],
    additionalProperties: false,
  },
  maxOutputTokens: 64,
  reasoningEffort: 'low',
  safetyIdentifier: `rk1_${'A'.repeat(43)}`,
})
const canonical = Buffer.from(canonicalizeRfc8785(request), 'utf8')

function sdkCall(
  fetchImpl: typeof fetch,
  headers = expectedPinnedAnthropicSdkHeaders('key'),
  url: string = ANTHROPIC_MESSAGES_URL,
) {
  return fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
  })
}

function boundary(outboundFetch: typeof fetch) {
  return createOneShotAnthropicFetch({
    apiKey: 'key',
    permitId: 'invented-permit',
    canonicalProviderBytes: Buffer.from(canonical),
    responseBytes: 4_096,
    outboundFetch,
    signal: new AbortController().signal,
  })
}

describe('one-shot Anthropic fetch boundary', () => {
  it('sends one exact POST with attested bytes and the five outbound headers', async () => {
    const outbound = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(_url)).toBe(ANTHROPIC_MESSAGES_URL)
      expect(init?.redirect).toBe('manual')
      expect(Buffer.from(init?.body as Uint8Array)).toEqual(canonical)
      expect(Object.fromEntries(new Headers(init?.headers).entries())).toEqual({
        accept: 'application/json',
        'anthropic-version': '2026-10-21',
        'content-type': 'application/json',
        'user-agent': ANTHROPIC_USER_AGENT,
        'x-api-key': 'key',
      })
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const value = boundary(outbound)
    await expect(
      sdkCall(value.fetch).then((response) => response.json()),
    ).resolves.toEqual({ ok: true })
    const retainedSdkBytes = value.state.sdkRequestBytes
    if (retainedSdkBytes === null) throw new Error('expected retained SDK bytes')
    await expect(sdkCall(value.fetch)).rejects.toBeInstanceOf(
      InvalidAnthropicRequestError,
    )
    expect(retainedSdkBytes.every((byte) => byte === 0)).toBe(true)
    expect(outbound).toHaveBeenCalledTimes(1)
  })

  it.each([
    [
      'wrong URL',
      'https://api.anthropic.com/v1/other',
      expectedPinnedAnthropicSdkHeaders('key'),
    ],
    ['query', `${ANTHROPIC_MESSAGES_URL}?x=1`, expectedPinnedAnthropicSdkHeaders('key')],
    [
      'extra header',
      ANTHROPIC_MESSAGES_URL,
      { ...expectedPinnedAnthropicSdkHeaders('key'), extra: '1' },
    ],
    [
      'missing header',
      ANTHROPIC_MESSAGES_URL,
      Object.fromEntries(
        Object.entries(expectedPinnedAnthropicSdkHeaders('key')).filter(
          ([name]) => name !== 'x-stainless-timeout',
        ),
      ),
    ],
  ])('refuses %s before outbound dispatch', async (_label, url, headers) => {
    const outbound = vi.fn()
    const value = boundary(outbound)
    await expect(sdkCall(value.fetch, headers, url)).rejects.toBeInstanceOf(
      InvalidAnthropicRequestError,
    )
    expect(outbound).not.toHaveBeenCalled()
  })

  it('refuses a non-POST SDK call and an already-aborted connector signal', async () => {
    const wrongMethodOutbound = vi.fn()
    const wrongMethod = boundary(wrongMethodOutbound)
    await expect(
      wrongMethod.fetch(ANTHROPIC_MESSAGES_URL, {
        method: 'PUT',
        headers: expectedPinnedAnthropicSdkHeaders('key'),
        body: JSON.stringify(request),
      }),
    ).rejects.toBeInstanceOf(InvalidAnthropicRequestError)
    expect(wrongMethodOutbound).not.toHaveBeenCalled()

    const controller = new AbortController()
    controller.abort('invented cancellation')
    const abortedOutbound = vi.fn()
    const aborted = createOneShotAnthropicFetch({
      apiKey: 'key',
      permitId: 'invented-permit',
      canonicalProviderBytes: Buffer.from(canonical),
      responseBytes: 4_096,
      outboundFetch: abortedOutbound,
      signal: controller.signal,
    })
    await expect(sdkCall(aborted.fetch)).rejects.toBeInstanceOf(
      InvalidAnthropicRequestError,
    )
    expect(abortedOutbound).not.toHaveBeenCalled()
  })

  it('refuses changed or subsequently mutated attested bytes', async () => {
    const outbound = vi.fn()
    const changed = boundary(outbound)
    await expect(
      changed.fetch(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: expectedPinnedAnthropicSdkHeaders('key'),
        body: JSON.stringify({ ...request, max_tokens: 65 }),
      }),
    ).rejects.toBeInstanceOf(InvalidAnthropicRequestError)

    const mutable = Buffer.from(canonical)
    const mutated = createOneShotAnthropicFetch({
      apiKey: 'key',
      permitId: 'invented-permit',
      canonicalProviderBytes: mutable,
      responseBytes: 4_096,
      outboundFetch: outbound,
      signal: new AbortController().signal,
    })
    mutable[0] = mutable[0] === 123 ? 91 : 123
    await expect(
      mutated.fetch(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: expectedPinnedAnthropicSdkHeaders('key'),
        body: mutable,
      }),
    ).rejects.toBeInstanceOf(InvalidAnthropicRequestError)
    expect(outbound).not.toHaveBeenCalled()
  })

  it('never follows redirects and discards a poisoned non-200 body', async () => {
    const value = boundary(
      async () =>
        new Response('invented provider detail', {
          status: 307,
          headers: { location: 'https://attacker.invalid', 'retry-after': '9' },
        }),
    )
    const response = await sdkCall(value.fetch)
    expect(response.status).toBe(307)
    expect(await response.text()).toBe('')
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('retry-after')).toBe('9')
  })

  it.each([
    [
      'content encoding',
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      }),
      InvalidAnthropicOutputError,
    ],
    [
      'non-strict JSON',
      new Response('{"x":1,"x":2}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      InvalidAnthropicOutputError,
    ],
    [
      'oversized body',
      new Response('12345', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      AmbiguousAnthropicTransportError,
    ],
  ])('rejects a %s response', async (_label, response, ErrorClass) => {
    const value = createOneShotAnthropicFetch({
      apiKey: 'key',
      permitId: 'invented-permit',
      canonicalProviderBytes: Buffer.from(canonical),
      responseBytes: _label === 'oversized body' ? 4 : 4_096,
      outboundFetch: async () => response,
      signal: new AbortController().signal,
    })
    await expect(sdkCall(value.fetch)).rejects.toBeInstanceOf(ErrorClass)
  })
})
