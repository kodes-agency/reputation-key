import { createServer } from 'node:http'
import { connect as connectTcp } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { Agent } from 'undici'
import {
  buildClosedOpenAiRequest,
  deriveOpenAiClientRequestId,
} from './prepared-invocation'
import {
  AmbiguousOpenAiTransportError,
  InvalidOpenAiOutputError,
  InvalidOpenAiRequestError,
  createOneShotOpenAiFetch,
  createPinnedOpenAiRequestFetch,
  PINNED_OPENAI_DISPATCHER_LIMITS,
} from './openai-connector'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'
import { OPENAI_RESPONSES_URL } from './contracts'

const PERMIT_ID = '10000000-0000-4000-8000-000000000002'
const request = buildClosedOpenAiRequest({
  route: 'review-analysis',
  promptVersion: 'review-analysis-prompt-v1',
  promptCacheShard: 4,
  developerMessage: 'Classify the quoted review data.',
  untrustedData: '{"reviewText":"safe"}',
  format: {
    type: 'json_schema',
    name: 'review_analysis',
    strict: true,
    schema: {
      type: 'object',
      properties: { sentiment: { type: 'string' } },
      required: ['sentiment'],
      additionalProperties: false,
    },
  },
  maxOutputTokens: 4_096,
  reasoningEffort: 'low',
  safetyIdentifier: `rk1_${'A'.repeat(43)}`,
})
const canonical = Buffer.from(canonicalizeRfc8785(request), 'utf8')

function pinnedSdkHeaders(): Record<string, string> {
  return {
    accept: 'application/json',
    authorization: 'Bearer test-key',
    'content-type': 'application/json',
    'user-agent': 'OpenAI/JS 7.43.0',
    'x-stainless-arch': process.arch,
    'x-stainless-lang': 'js',
    'x-stainless-os': process.platform === 'darwin' ? 'MacOS' : 'Linux',
    'x-stainless-package-version': '7.43.0',
    'x-stainless-retry-count': '0',
    'x-stainless-runtime': 'node',
    'x-stainless-runtime-version': process.version,
  }
}

function sdkRequest(
  fetchImpl: typeof fetch,
  headers = pinnedSdkHeaders(),
  url = 'https://api.openai.com/v1/responses',
) {
  return fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
  })
}

function oneShot(
  input: Readonly<{
    outboundFetch: typeof fetch
    bytes?: Buffer
    responseBytes?: number
  }>,
) {
  return createOneShotOpenAiFetch({
    apiKey: 'test-key',
    permitId: PERMIT_ID,
    canonicalProviderBytes: input.bytes ?? canonical,
    responseBytes: input.responseBytes ?? 131_072,
    outboundFetch: input.outboundFetch,
    signal: new AbortController().signal,
  })
}

describe('one-shot OpenAI fetch boundary', () => {
  it('sends one exact POST with canonical bytes and the minimal header profile', async () => {
    const outboundFetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(String(_url)).toBe('https://api.openai.com/v1/responses')
        expect(init?.method).toBe('POST')
        expect(init?.redirect).toBe('manual')
        expect(Buffer.from(init?.body as Uint8Array)).toEqual(canonical)
        expect(Object.fromEntries(new Headers(init?.headers).entries())).toEqual({
          accept: 'application/json',
          authorization: 'Bearer test-key',
          'content-type': 'application/json',
          'user-agent': 'repkey-ai-egress-gateway/1.0',
          'x-client-request-id': deriveOpenAiClientRequestId(PERMIT_ID),
        })
        return new Response('{"output":[],"usage":{}}', {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'x-request-id': 'must-not-escape',
          },
        })
      },
    )
    const boundary = oneShot({ outboundFetch })
    const response = await sdkRequest(boundary.fetch)
    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeNull()
    expect(await response.text()).toBe('{"output":[],"usage":{}}')
    expect(boundary.state.outboundFetchUsed).toBe(true)
    await expect(sdkRequest(boundary.fetch)).rejects.toThrow(InvalidOpenAiRequestError)
    expect(outboundFetch).toHaveBeenCalledTimes(1)
  })

  it('delivers a 200 body that echoes fractional provider sampling parameters', async () => {
    const body = '{"output":[],"usage":{},"top_p":0.98,"temperature":1.5}'
    const boundary = oneShot({
      outboundFetch: async () =>
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    })
    const response = await sdkRequest(boundary.fetch)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(body)
  })

  it('never follows redirects and discards poisoned non-200 bodies', async () => {
    const outboundFetch = vi.fn(
      async () =>
        new Response('secret-provider-error', {
          status: 307,
          headers: {
            location: 'https://attacker.invalid/',
            'retry-after': ' 10 ',
            'x-request-id': 'provider-id',
          },
        }),
    )
    const boundary = oneShot({ outboundFetch })
    const response = await sdkRequest(boundary.fetch)
    expect(response.status).toBe(307)
    expect(await response.text()).toBe('')
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('retry-after')).toBe('10')
    expect(boundary.state.completeStatus).toBe(307)
    expect(outboundFetch).toHaveBeenCalledTimes(1)
  })

  it('distinguishes pre-dispatch validation from post-dispatch ambiguity', async () => {
    const pre = oneShot({ outboundFetch: vi.fn() })
    await expect(
      pre.fetch('https://api.openai.com/v1/other', { method: 'POST', body: '{}' }),
    ).rejects.toThrow(InvalidOpenAiRequestError)
    expect(pre.state.outboundFetchUsed).toBe(false)
    const post = oneShot({
      outboundFetch: vi.fn(async () => {
        throw new Error('socket reset')
      }),
    })
    await expect(sdkRequest(post.fetch)).rejects.toBeInstanceOf(
      AmbiguousOpenAiTransportError,
    )
    expect(post.state.outboundFetchUsed).toBe(true)
  })

  it('rechecks the exact attested bytes at the outbound dispatch boundary', async () => {
    const outboundFetch = vi.fn()
    const mutableBytes = Buffer.from(canonical)
    const boundary = oneShot({ bytes: mutableBytes, outboundFetch })
    const sentinelOffset = mutableBytes.indexOf('safe', 0, 'utf8')
    expect(sentinelOffset).toBeGreaterThanOrEqual(0)
    mutableBytes[sentinelOffset] = 'f'.charCodeAt(0)
    await expect(
      boundary.fetch(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: pinnedSdkHeaders(),
        body: mutableBytes.toString('utf8'),
      }),
    ).rejects.toThrow(InvalidOpenAiRequestError)
    expect(boundary.state.outboundFetchUsed).toBe(false)
    expect(outboundFetch).not.toHaveBeenCalled()
    boundary.dispose()
  })

  it('rejects a second SDK invocation after the first materializes an invalid body and zeroes it', async () => {
    const outboundFetch = vi.fn()
    const boundary = oneShot({ outboundFetch })
    await expect(
      boundary.fetch(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: pinnedSdkHeaders(),
        body: JSON.stringify({ ...request, model: 'forbidden-alias' }),
      }),
    ).rejects.toThrow(InvalidOpenAiRequestError)
    const retained = boundary.state.sdkRequestBytes
    if (retained === null) throw new Error('expected retained SDK request bytes')
    expect(retained.some((byte) => byte !== 0)).toBe(true)
    await expect(sdkRequest(boundary.fetch)).rejects.toThrow(InvalidOpenAiRequestError)
    expect(retained.every((byte) => byte === 0)).toBe(true)
    expect(outboundFetch).not.toHaveBeenCalled()
  })

  it('rejects non-strict JSON success media and oversized/incomplete responses', async () => {
    const invalidMedia = oneShot({
      responseBytes: 16,
      outboundFetch: async () =>
        new Response('{}', { status: 200, headers: { 'content-type': 'text/json' } }),
    })
    await expect(sdkRequest(invalidMedia.fetch)).rejects.toBeInstanceOf(
      InvalidOpenAiOutputError,
    )
    const oversized = oneShot({
      responseBytes: 4,
      outboundFetch: async () =>
        new Response('12345', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    })
    await expect(sdkRequest(oversized.fetch)).rejects.toBeInstanceOf(
      AmbiguousOpenAiTransportError,
    )
  })

  it('zeroes every observed response chunk when overflow cancellation fails', async () => {
    const first = Uint8Array.from([1, 2])
    const overflow = Uint8Array.from([3, 4, 5])
    let index = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(index++ === 0 ? first : overflow)
      },
      cancel() {
        throw new Error('cancel failed')
      },
    })
    const boundary = oneShot({
      responseBytes: 4,
      outboundFetch: async () =>
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    })
    await expect(sdkRequest(boundary.fetch)).rejects.toBeInstanceOf(
      AmbiguousOpenAiTransportError,
    )
    expect(first).toEqual(Uint8Array.from([0, 0]))
    expect(overflow).toEqual(Uint8Array.from([0, 0, 0]))
  })

  it('bounds response chunk count and zeroes the chunk that crosses the cap', async () => {
    const chunks = Array.from({ length: 1_025 }, () => Uint8Array.of(65))
    let index = 0
    const cancel = vi.fn()
    const boundary = oneShot({
      responseBytes: 2_048,
      outboundFetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(chunks[index++]!)
            },
            cancel,
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
    })
    await expect(sdkRequest(boundary.fetch)).rejects.toBeInstanceOf(
      AmbiguousOpenAiTransportError,
    )
    expect(index).toBeGreaterThanOrEqual(1_025)
    expect(cancel).toHaveBeenCalledTimes(1)
    for (const chunk of chunks) expect(chunk[0]).toBe(0)
  })

  it.each([
    [
      'unknown header',
      { ...pinnedSdkHeaders(), 'x-unknown': '1' },
      'https://api.openai.com/v1/responses',
    ],
    [
      'joined header',
      { ...pinnedSdkHeaders(), accept: 'application/json, application/json' },
      'https://api.openai.com/v1/responses',
    ],
    [
      'authorization',
      { ...pinnedSdkHeaders(), authorization: 'Bearer changed' },
      'https://api.openai.com/v1/responses',
    ],
    [
      'content type',
      { ...pinnedSdkHeaders(), 'content-type': 'text/json' },
      'https://api.openai.com/v1/responses',
    ],
    [
      'accept',
      { ...pinnedSdkHeaders(), accept: '*/*' },
      'https://api.openai.com/v1/responses',
    ],
    [
      'user agent',
      { ...pinnedSdkHeaders(), 'user-agent': 'OpenAI/JS 7.20.1' },
      'https://api.openai.com/v1/responses',
    ],
    [
      'operation key',
      { ...pinnedSdkHeaders(), 'idempotency-key': 'operation-key' },
      'https://api.openai.com/v1/responses',
    ],
    ['query', pinnedSdkHeaders(), 'https://api.openai.com/v1/responses?x=1'],
  ])('rejects a changed SDK request profile: %s', async (_name, headers, url) => {
    const outboundFetch = vi.fn()
    const boundary = oneShot({ outboundFetch })
    await expect(sdkRequest(boundary.fetch, headers, url)).rejects.toThrow(
      InvalidOpenAiRequestError,
    )
    expect(boundary.state.outboundFetchUsed).toBe(false)
    expect(outboundFetch).not.toHaveBeenCalled()
  })
})

describe('pinned OpenAI request transport', () => {
  it('refuses HTTP/2 so the one-request HTTP/1 isolation controls remain effective', () => {
    expect(PINNED_OPENAI_DISPATCHER_LIMITS).toMatchObject({
      allowH2: false,
      connections: 1,
      pipelining: 0,
      maxRequestsPerClient: 1,
    })
  })

  it('does not add Accept-Encoding to the actual socket request', async () => {
    let observedHeaders: Readonly<Record<string, string | string[] | undefined>> | null =
      null
    const server = createServer((incoming, response) => {
      observedHeaders = incoming.headers
      incoming.resume()
      incoming.once('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{}')
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string') {
      server.close()
      throw new Error('expected TCP server address')
    }
    const dispatcher = new Agent({
      connect: (_options, callback) => {
        const socket = connectTcp(address.port, '127.0.0.1')
        socket.once('error', (error) => callback(error, null))
        socket.once('connect', () => callback(null, socket))
      },
    })
    const callerBody = Buffer.from(canonical)
    const callerSnapshot = Buffer.from(callerBody)
    try {
      const response = await createPinnedOpenAiRequestFetch(dispatcher)(
        OPENAI_RESPONSES_URL,
        {
          method: 'POST',
          redirect: 'manual',
          headers: {
            accept: 'application/json',
            authorization: 'Bearer test-key',
            'content-type': 'application/json',
            'user-agent': 'repkey-ai-egress-gateway/1.0',
            'x-client-request-id': deriveOpenAiClientRequestId(PERMIT_ID),
          },
          body: callerBody,
        },
      )
      await expect(response.text()).resolves.toBe('{}')
      expect(observedHeaders).not.toBeNull()
      expect(observedHeaders).not.toHaveProperty('accept-encoding')
      expect(observedHeaders).toMatchObject({
        accept: 'application/json',
        authorization: 'Bearer test-key',
        'content-type': 'application/json',
        'user-agent': 'repkey-ai-egress-gateway/1.0',
        'x-client-request-id': deriveOpenAiClientRequestId(PERMIT_ID),
      })
      expect(callerBody).toEqual(callerSnapshot)
    } finally {
      await dispatcher.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
