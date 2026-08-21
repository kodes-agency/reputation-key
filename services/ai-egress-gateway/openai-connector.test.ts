import { generateKeyPairSync } from 'node:crypto'
import { createServer } from 'node:http'
import { connect as connectTcp } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { Agent } from 'undici'
import { zodTextFormat } from 'openai/helpers/zod'
import { AI_OPERATION_PROFILES } from '../../src/shared/ai-operation-profiles'
import {
  signAiExecutionGrant,
  type AiAdmissionDescriptorV1,
  type AiExecutionGrantV1,
} from '../../src/shared/ai-internal-transport-contract'
import { createVersionedHmacKeyring } from '../../src/shared/security/versioned-hmac-keyring'
import {
  buildClosedOpenAiRequest,
  createPreparedAiInvocation,
  deriveOpenAiClientRequestId,
} from './prepared-invocation'
import {
  AmbiguousOpenAiTransportError,
  InvalidOpenAiOutputError,
  createOneShotOpenAiFetch,
  hasOfficialOpenAiRefusal,
  isForbiddenOpenAiAddress,
  createOpenAiConnector,
  createPinnedOpenAiRequestFetch,
  createRestrictedOpenAiLookup,
} from './openai-connector'
import { canonicalizeRfc8785 } from '../../src/shared/merchant-ai-notice-contract'
import { OPENAI_RESPONSES_URL, type ClosedJsonSchemaFormat } from './contracts'

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
    'user-agent': 'OpenAI/JS 7.4.0',
    'x-stainless-arch': process.arch,
    'x-stainless-lang': 'js',
    'x-stainless-os': process.platform === 'darwin' ? 'MacOS' : 'Linux',
    'x-stainless-package-version': '7.4.0',
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
    const boundary = createOneShotOpenAiFetch({
      apiKey: 'test-key',
      permitId: PERMIT_ID,
      canonicalProviderBytes: canonical,
      responseBytes: 131_072,
      outboundFetch,
      signal: new AbortController().signal,
    })
    const response = await sdkRequest(boundary.fetch)
    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeNull()
    expect(await response.text()).toBe('{"output":[],"usage":{}}')
    expect(boundary.state.outboundFetchUsed).toBe(true)
    await expect(sdkRequest(boundary.fetch)).rejects.toThrow()
    expect(outboundFetch).toHaveBeenCalledTimes(1)
  })

  it('delivers a 200 body that echoes fractional provider sampling parameters', async () => {
    const body = '{"output":[],"usage":{},"top_p":0.98,"temperature":1.5}'
    const boundary = createOneShotOpenAiFetch({
      apiKey: 'test-key',
      permitId: PERMIT_ID,
      canonicalProviderBytes: canonical,
      responseBytes: 131_072,
      outboundFetch: async () =>
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      signal: new AbortController().signal,
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
    const boundary = createOneShotOpenAiFetch({
      apiKey: 'test-key',
      permitId: PERMIT_ID,
      canonicalProviderBytes: canonical,
      responseBytes: 131_072,
      outboundFetch,
      signal: new AbortController().signal,
    })
    const response = await sdkRequest(boundary.fetch)
    expect(response.status).toBe(307)
    expect(await response.text()).toBe('')
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('retry-after')).toBe('10')
    expect(boundary.state.completeStatus).toBe(307)
    expect(outboundFetch).toHaveBeenCalledTimes(1)
  })

  it('distinguishes pre-dispatch validation from post-dispatch ambiguity', async () => {
    const pre = createOneShotOpenAiFetch({
      apiKey: 'test-key',
      permitId: PERMIT_ID,
      canonicalProviderBytes: canonical,
      responseBytes: 131_072,
      outboundFetch: vi.fn(),
      signal: new AbortController().signal,
    })
    await expect(
      pre.fetch('https://api.openai.com/v1/other', { method: 'POST', body: '{}' }),
    ).rejects.toThrow()
    expect(pre.state.outboundFetchUsed).toBe(false)
    const post = createOneShotOpenAiFetch({
      apiKey: 'test-key',
      permitId: PERMIT_ID,
      canonicalProviderBytes: canonical,
      responseBytes: 131_072,
      outboundFetch: vi.fn(async () => {
        throw new Error('socket reset')
      }),
      signal: new AbortController().signal,
    })
    await expect(sdkRequest(post.fetch)).rejects.toBeInstanceOf(
      AmbiguousOpenAiTransportError,
    )
    expect(post.state.outboundFetchUsed).toBe(true)
  })

  it('rechecks the exact attested bytes at the outbound dispatch boundary', async () => {
    const outboundFetch = vi.fn()
    const mutableBytes = Buffer.from(canonical)
    const boundary = createOneShotOpenAiFetch({
      apiKey: 'test-key',
      permitId: PERMIT_ID,
      canonicalProviderBytes: mutableBytes,
      responseBytes: 131_072,
      outboundFetch,
      signal: new AbortController().signal,
    })
    const sentinelOffset = mutableBytes.indexOf('safe', 0, 'utf8')
    expect(sentinelOffset).toBeGreaterThanOrEqual(0)
    mutableBytes[sentinelOffset] = 'f'.charCodeAt(0)
    await expect(
      boundary.fetch(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: pinnedSdkHeaders(),
        body: mutableBytes.toString('utf8'),
      }),
    ).rejects.toThrow()
    expect(boundary.state.outboundFetchUsed).toBe(false)
    expect(outboundFetch).not.toHaveBeenCalled()
    boundary.dispose()
  })

  it('rejects a second SDK invocation after the first materializes an invalid body and zeroes it', async () => {
    const outboundFetch = vi.fn()
    const boundary = createOneShotOpenAiFetch({
      apiKey: 'test-key',
      permitId: PERMIT_ID,
      canonicalProviderBytes: canonical,
      responseBytes: 131_072,
      outboundFetch,
      signal: new AbortController().signal,
    })
    await expect(
      boundary.fetch(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: pinnedSdkHeaders(),
        body: JSON.stringify({ ...request, model: 'forbidden-alias' }),
      }),
    ).rejects.toThrow()
    const retained = boundary.state.sdkRequestBytes
    if (retained === null) throw new Error('expected retained SDK request bytes')
    expect(retained.some((byte) => byte !== 0)).toBe(true)
    await expect(sdkRequest(boundary.fetch)).rejects.toThrow()
    expect(retained.every((byte) => byte === 0)).toBe(true)
    expect(outboundFetch).not.toHaveBeenCalled()
  })

  it('rejects non-strict JSON success media and oversized/incomplete responses', async () => {
    const invalidMedia = createOneShotOpenAiFetch({
      apiKey: 'test-key',
      permitId: PERMIT_ID,
      canonicalProviderBytes: canonical,
      responseBytes: 16,
      outboundFetch: async () =>
        new Response('{}', { status: 200, headers: { 'content-type': 'text/json' } }),
      signal: new AbortController().signal,
    })
    await expect(sdkRequest(invalidMedia.fetch)).rejects.toBeInstanceOf(
      InvalidOpenAiOutputError,
    )
    const oversized = createOneShotOpenAiFetch({
      apiKey: 'test-key',
      permitId: PERMIT_ID,
      canonicalProviderBytes: canonical,
      responseBytes: 4,
      outboundFetch: async () =>
        new Response('12345', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      signal: new AbortController().signal,
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
    const boundary = createOneShotOpenAiFetch({
      apiKey: 'test-key',
      permitId: PERMIT_ID,
      canonicalProviderBytes: canonical,
      responseBytes: 4,
      outboundFetch: async () =>
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      signal: new AbortController().signal,
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
    const boundary = createOneShotOpenAiFetch({
      apiKey: 'test-key',
      permitId: PERMIT_ID,
      canonicalProviderBytes: canonical,
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
      signal: new AbortController().signal,
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
      { ...pinnedSdkHeaders(), 'user-agent': 'OpenAI/JS 7.4.1' },
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
    const boundary = createOneShotOpenAiFetch({
      apiKey: 'test-key',
      permitId: PERMIT_ID,
      canonicalProviderBytes: canonical,
      responseBytes: 131_072,
      outboundFetch,
      signal: new AbortController().signal,
    })
    await expect(sdkRequest(boundary.fetch, headers, url)).rejects.toThrow()
    expect(boundary.state.outboundFetchUsed).toBe(false)
    expect(outboundFetch).not.toHaveBeenCalled()
  })
})

describe('pinned OpenAI request transport', () => {
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

describe('OpenAI connector security classifiers', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.0.0.1',
    '192.0.2.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '192.31.196.1',
    '192.52.193.1',
    '192.175.48.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:8.8.8.8',
    '100::1',
    '2001:db8::1',
    'fc00::1',
    'fe80::1',
    'ff00::1',
    '::192.0.2.1',
    '64:ff9b:1::1',
    '64:ff9b::1',
    '2620:4f:8000::1',
    'fec0::1',
    '3fff::1',
    '5f00::1',
    'not-an-ip',
  ])('rejects non-global DNS address %s', (address) => {
    expect(isForbiddenOpenAiAddress(address)).toBe(true)
  })

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])(
    'admits public DNS address %s',
    (address) => {
      expect(isForbiddenOpenAiAddress(address)).toBe(false)
    },
  )

  it.each([
    ['64:ff9b::', true],
    ['64:ff9b::ffff:ffff', true],
    ['64:ff9a:ffff:ffff:ffff:ffff:ffff:ffff', false],
    ['64:ff9b:0:0:0:1::', false],
    ['2620:4f:8000::', true],
    ['2620:4f:8000:ffff:ffff:ffff:ffff:ffff', true],
    ['2620:4f:7fff:ffff:ffff:ffff:ffff:ffff', false],
    ['2620:4f:8001::', false],
  ])('classifies the exact IANA special-use boundary %s', (address, forbidden) => {
    expect(isForbiddenOpenAiAddress(address)).toBe(forbidden)
  })

  it('recognizes only an official response message refusal shape', () => {
    expect(
      hasOfficialOpenAiRefusal({
        output: [
          { type: 'message', content: [{ type: 'refusal', refusal: 'not allowed' }] },
        ],
      }),
    ).toBe(true)
    expect(hasOfficialOpenAiRefusal({ refusal: 'not allowed' })).toBe(false)
    expect(
      hasOfficialOpenAiRefusal({
        output: [{ type: 'message', content: [{ type: 'refusal', refusal: 42 }] }],
      }),
    ).toBe(false)
  })

  it('rejects an entire DNS resolution containing any non-public answer', async () => {
    const dns = vi.fn(
      (
        _hostname: string,
        options: Readonly<{ all: true; verbatim: true }>,
        callback: (
          error: NodeJS.ErrnoException | null,
          addresses: readonly Readonly<{ address: string; family: number }>[],
        ) => void,
      ) => {
        expect(options).toEqual({ all: true, verbatim: true })
        callback(null, [
          { address: '127.0.0.1', family: 4 },
          { address: '1.1.1.1', family: 4 },
        ])
      },
    )
    const lookup = createRestrictedOpenAiLookup(dns)
    await expect(
      new Promise((resolve, reject) => {
        lookup('api.openai.com', { family: 4 }, (error, address) => {
          if (error) reject(error)
          else resolve(address)
        })
      }),
    ).rejects.toThrow('forbidden')
  })

  it('pins one result only after every DNS answer is public', async () => {
    const lookup = createRestrictedOpenAiLookup((_hostname, _options, callback) => {
      callback(null, [
        { address: '1.1.1.1', family: 4 },
        { address: '2606:4700:4700::1111', family: 6 },
      ])
    })
    const selected = await new Promise((resolve, reject) => {
      lookup('api.openai.com', { family: 4 }, (error, address) => {
        if (error || address === undefined) reject(error ?? new Error('missing address'))
        else resolve(address)
      })
    })
    expect(selected).toBe('1.1.1.1')
  })
})

const connectorOutputSchema = z.object({ ok: z.boolean() }).strict()
const connectorFormat = JSON.parse(
  JSON.stringify(zodTextFormat(connectorOutputSchema, 'canary_result')),
) as ClosedJsonSchemaFormat
const connectorKeyring = createVersionedHmacKeyring(`request-v1:${'11'.repeat(32)}`)
const connectorSigningKeys = generateKeyPairSync('ed25519')
let connectorNonce = 0

function connectorDescriptor(
  derived: Parameters<
    Parameters<typeof createPreparedAiInvocation>[0]['createDescriptor']
  >[0],
): AiAdmissionDescriptorV1 {
  return {
    version: 'ai-admission-descriptor-v1',
    subjectKind: 'synthetic_canary',
    route: 'synthetic-canary',
    operationId: '10000000-0000-4000-8000-000000000001',
    permitId: PERMIT_ID,
    attemptNumber: 1,
    organizationId: null,
    propertyId: null,
    internalSubjectId: null,
    actorId: null,
    binding: null,
    canaryBinding: {
      canaryAuthorizationId: '10000000-0000-4000-8000-000000000003',
      canaryAuthorizationGeneration: 1,
      releaseSha: 'b'.repeat(40),
      canaryProfileVersion: 'synthetic-canary-v1',
      safetyIdentifierProfileVersion: 'synthetic-canary-safety-v1',
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      operationProfileVersion: 'synthetic-canary-v1',
      stopFence: {
        globalControlId: '10000000-0000-4000-8000-000000000004',
        globalGeneration: 1,
        providerControlId: '10000000-0000-4000-8000-000000000005',
        providerGeneration: 1,
        allCapabilityStopFences: [
          {
            capability: 'review_analysis',
            capabilityControlId: '10000000-0000-4000-8000-000000000006',
            capabilityGeneration: 1,
          },
          {
            capability: 'reply_drafting',
            capabilityControlId: '10000000-0000-4000-8000-000000000007',
            capabilityGeneration: 1,
          },
          {
            capability: 'property_trends',
            capabilityControlId: '10000000-0000-4000-8000-000000000008',
            capabilityGeneration: 1,
          },
        ],
      },
    },
    releaseSha: 'b'.repeat(40),
    canaryAuthorizationId: '10000000-0000-4000-8000-000000000003',
    ...derived,
    limits: {
      sourceBytes: 16_384,
      providerPayloadBytes: 16_384,
      preparedRequestBytes: 65_536,
      responseBytes: 131_072,
      outputTokens: 4_096,
      costMicros: 100_000,
    },
    callerDeadlineEpochMillis: 1_780_000_070_000,
    observedContentExpiresAtEpochMillis: null,
    redactionCountry: null,
    redactionProfileVersion: null,
    outputLeakageProfileVersion: null,
    outputLeakageProfileDigest: null,
    replyTemplateCatalogueVersion: null,
    replyTemplateCatalogueDigest: null,
  }
}

function createConnectorHarness(outboundFetch: typeof fetch) {
  const sdkRequest = buildClosedOpenAiRequest({
    route: 'synthetic-canary',
    promptVersion: 'synthetic-canary-prompt-v1',
    promptCacheShard: 0,
    developerMessage: 'Return the fixed canary marker.',
    untrustedData: '{"canary":true}',
    format: connectorFormat,
    maxOutputTokens: 4_096,
    reasoningEffort: 'low',
    safetyIdentifier: `rk1_${'A'.repeat(43)}`,
  })
  const invocation = createPreparedAiInvocation({
    sourceBytes: Uint8Array.of(1),
    providerPayload: { canary: true },
    sdkRequest,
    createDescriptor: connectorDescriptor,
    requestBindingKeys: connectorKeyring,
  })
  connectorNonce += 1
  const grant = signAiExecutionGrant(
    {
      version: 'ai-execution-grant-v1',
      subjectKind: 'synthetic_canary',
      grantKid: 'grant-v1',
      requestBindingKeyId: invocation.requestBindingKeyId,
      requestBindingHmac: invocation.requestBindingHmac,
      route: 'synthetic-canary',
      operationId: invocation.descriptor.operationId,
      permitId: invocation.descriptor.permitId,
      attemptNumber: 1,
      nonce: Buffer.alloc(32, connectorNonce).toString('base64url'),
      limits: invocation.descriptor.limits,
      callerDeadlineEpochMillis: invocation.descriptor.callerDeadlineEpochMillis,
      issuedAtEpochMillis: 1_780_000_000_000,
      expiresAtEpochMillis: invocation.descriptor.callerDeadlineEpochMillis,
      replyTokenExpiresAtEpochMillis: null,
      replyDraftExpiresAtEpochMillis: null,
    },
    connectorSigningKeys.privateKey,
  )
  const connector = createOpenAiConnector({
    apiKey: 'test-key',
    requestBindingKeys: connectorKeyring,
    admissionPublicKeys: new Map([['grant-v1', connectorSigningKeys.publicKey]]),
    outboundFetch,
    now: () => 1_780_000_001_000,
  })
  return {
    connector,
    invocation,
    grant,
    canonicalBody: Buffer.from(canonicalizeRfc8785(sdkRequest), 'utf8'),
  }
}

function providerResponse(
  input: Readonly<{
    parsed?: Readonly<{ ok: boolean }> | null
    refusal?: string
    usage?: Readonly<{
      inputTokens: number
      cachedTokens: number
      outputTokens: number
      reasoningTokens: number
      totalTokens: number
    }>
    incomplete?: Readonly<{ reason: string }>
    emptyOutput?: boolean
  }> = {},
): Response {
  const usage = input.usage ?? {
    inputTokens: 10,
    cachedTokens: 2,
    outputTokens: 5,
    reasoningTokens: 1,
    totalTokens: 15,
  }
  const content =
    input.refusal === undefined
      ? [
          {
            type: 'output_text',
            text: JSON.stringify(
              input.parsed === undefined ? { ok: true } : input.parsed,
            ),
            annotations: [],
            logprobs: [],
          },
        ]
      : [{ type: 'refusal', refusal: input.refusal }]
  return new Response(
    JSON.stringify({
      id: 'must-not-escape',
      object: 'response',
      created_at: 1_780_000_000,
      status: input.incomplete === undefined ? 'completed' : 'incomplete',
      error: null,
      incomplete_details: input.incomplete ?? null,
      instructions: null,
      max_output_tokens: 4096,
      model: 'gpt-5.4-mini-2026-03-17',
      output: input.emptyOutput
        ? []
        : [
            {
              id: 'provider-message-id',
              type: 'message',
              status: 'completed',
              role: 'assistant',
              content,
            },
          ],
      parallel_tool_calls: false,
      previous_response_id: null,
      reasoning: { effort: 'xhigh', summary: null },
      service_tier: 'default',
      store: false,
      temperature: null,
      text: { format: { type: 'json_schema' }, verbosity: 'medium' },
      tool_choice: 'auto',
      tools: [],
      top_logprobs: 0,
      top_p: null,
      truncation: 'disabled',
      usage: {
        input_tokens: usage.inputTokens,
        input_tokens_details: { cached_tokens: usage.cachedTokens },
        output_tokens: usage.outputTokens,
        output_tokens_details: { reasoning_tokens: usage.reasoningTokens },
        total_tokens: usage.totalTokens,
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

describe('official OpenAI SDK connector integration', () => {
  it('passes exact attested bytes through SDK 7.4 and returns parsed output with bounded usage', async () => {
    let expectedBody = Buffer.alloc(0)
    const outbound = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(_url)).toBe('https://api.openai.com/v1/responses')
      expect(Buffer.from(init?.body as Uint8Array)).toEqual(expectedBody)
      return providerResponse()
    })
    const harness = createConnectorHarness(outbound)
    expectedBody = harness.canonicalBody
    const outcome = await harness.connector.invoke(
      harness.invocation,
      harness.grant,
      connectorOutputSchema,
      new AbortController().signal,
    )
    expect(outcome).toMatchObject({
      disposition: 'success',
      result: { ok: true },
      usage: {
        inputTokens: 10,
        cachedTokens: 2,
        outputTokens: 5,
        reasoningTokens: 1,
        totalTokens: 15,
      },
      outboundFetchUsed: true,
    })
    expect(outbound).toHaveBeenCalledTimes(1)
  })

  it('maps official refusal, null output, and invalid usage without releasing output', async () => {
    for (const [responseValue, disposition] of [
      [providerResponse({ refusal: 'not allowed' }), 'provider_refused'],
      [providerResponse({ parsed: null }), 'output_invalid'],
      [
        providerResponse({
          usage: {
            inputTokens: 10,
            cachedTokens: 11,
            outputTokens: 5,
            reasoningTokens: 1,
            totalTokens: 15,
          },
        }),
        'output_invalid',
      ],
    ] as const) {
      const harness = createConnectorHarness(async () => responseValue)
      const outcome = await harness.connector.invoke(
        harness.invocation,
        harness.grant,
        connectorOutputSchema,
        new AbortController().signal,
      )
      expect(outcome.disposition).toBe(disposition)
      expect(outcome.result).toBeNull()
    }
  })

  it('names a truncated answer output_truncated, not output_invalid', async () => {
    // The distinction is the whole point: a truncated response is a fully-billed
    // provider call that returned nothing, and reporting it as `output_invalid`
    // made it indistinguishable from a malformed answer. That is what hid a
    // global reasoning-effort fault, where every route burned its output budget
    // on reasoning and returned an empty body.
    for (const reason of ['max_output_tokens', 'content_filter'] as const) {
      const harness = createConnectorHarness(async () =>
        providerResponse({ parsed: null, incomplete: { reason } }),
      )
      const outcome = await harness.connector.invoke(
        harness.invocation,
        harness.grant,
        connectorOutputSchema,
        new AbortController().signal,
      )
      expect(outcome.disposition).toBe('output_truncated')
      expect(outcome.result).toBeNull()
      // Still billed, still not worth retrying at the same ceiling.
      expect(outcome.usageKnown).toBe(true)
      expect(outcome.providerRetryable).toBe(false)
    }
  })

  it('releases no content from a truncated response that carries valid output text', async () => {
    // My first attempt asserted this returned `success`, on the assumption that a
    // truncated answer which still satisfies the schema is a good answer. It is
    // not reachable: the SDK parses only when `status === 'completed'`
    // (openai/lib/ResponsesParser.js `shouldParse`), so `output_parsed` is null
    // however complete the text looks. The real property is containment - a
    // partial answer never escapes, even when it would have parsed.
    const harness = createConnectorHarness(async () =>
      providerResponse({ incomplete: { reason: 'max_output_tokens' } }),
    )
    const outcome = await harness.connector.invoke(
      harness.invocation,
      harness.grant,
      connectorOutputSchema,
      new AbortController().signal,
    )
    expect(outcome.disposition).toBe('output_truncated')
    expect(outcome.result).toBeNull()
  })

  it('still says output_invalid when a completed response yields no parse', async () => {
    // The other arm of the same branch, and the reason it is a ternary rather
    // than an unconditional `output_truncated`. A completed response with an
    // empty output array parses to nothing without the SDK throwing, so it
    // reaches the same code path as a truncated one and must NOT borrow its
    // name: nothing was cut short, the provider simply said nothing.
    const harness = createConnectorHarness(async () =>
      providerResponse({ emptyOutput: true }),
    )
    const outcome = await harness.connector.invoke(
      harness.invocation,
      harness.grant,
      connectorOutputSchema,
      new AbortController().signal,
    )
    expect(outcome.disposition).toBe('output_invalid')
    expect(outcome.result).toBeNull()
  })

  it('accepts the exact profile input-token ceiling and rejects one token above it', async () => {
    const profile = AI_OPERATION_PROFILES.find(
      (candidate) => candidate.profileVersion === 'synthetic-canary-v1',
    )
    expect(profile).toBeDefined()
    for (const offset of [0, 1] as const) {
      let ceiling = 0
      const harness = createConnectorHarness(async () =>
        providerResponse({
          usage: {
            inputTokens: ceiling + offset,
            cachedTokens: 0,
            outputTokens: 1,
            reasoningTokens: 0,
            totalTokens: ceiling + offset + 1,
          },
        }),
      )
      ceiling =
        (profile?.staticTokenBearingBytes ?? 0) +
        harness.invocation.descriptor.providerPayloadByteCount
      const outcome = await harness.connector.invoke(
        harness.invocation,
        harness.grant,
        connectorOutputSchema,
        new AbortController().signal,
      )
      expect(outcome.disposition).toBe(offset === 0 ? 'success' : 'output_invalid')
      expect(outcome.usage.inputTokens).toBe(offset === 0 ? ceiling : 0)
    }
  })

  it.each([
    [429, 'rate_limited', 17],
    [500, 'provider_unavailable', null],
    [502, 'provider_unavailable', null],
    [503, 'provider_unavailable', null],
    [504, 'provider_unavailable', null],
    [418, 'provider_refused', null],
    [307, 'provider_unavailable', null],
  ])(
    'maps complete status %i without an SDK retry',
    async (status, disposition, retryAfter) => {
      const outbound = vi.fn(
        async () =>
          new Response('poison', {
            status,
            headers: retryAfter === null ? {} : { 'retry-after': String(retryAfter) },
          }),
      )
      const harness = createConnectorHarness(outbound)
      const outcome = await harness.connector.invoke(
        harness.invocation,
        harness.grant,
        connectorOutputSchema,
        new AbortController().signal,
      )
      expect(outcome).toMatchObject({
        disposition,
        result: null,
        retryAfterSeconds: retryAfter,
      })
      expect(outbound).toHaveBeenCalledTimes(1)
    },
  )

  it.each([
    [
      'malformed grant',
      (harness: ReturnType<typeof createConnectorHarness>) => ({
        ...harness.grant,
        grantSignature: '*'.repeat(86),
      }),
    ],
    [
      'wrong signed expiry',
      (harness: ReturnType<typeof createConnectorHarness>) => {
        const { grantSignature: _discarded, ...unsigned } = harness.grant
        void _discarded
        return signAiExecutionGrant(
          {
            ...unsigned,
            callerDeadlineEpochMillis: unsigned.callerDeadlineEpochMillis - 1,
            expiresAtEpochMillis: unsigned.expiresAtEpochMillis - 1,
          },
          connectorSigningKeys.privateKey,
        )
      },
    ],
  ])('returns no-dispatch and zeroes bytes for a %s', async (_label, mutateGrant) => {
    const outbound = vi.fn(async () => providerResponse())
    const harness = createConnectorHarness(outbound)
    const outcome = await harness.connector.invoke(
      harness.invocation,
      mutateGrant(harness) as AiExecutionGrantV1,
      connectorOutputSchema,
      new AbortController().signal,
    )
    expect(outcome.disposition).toBe('no_dispatch')
    expect(outbound).not.toHaveBeenCalled()
    expect(harness.invocation.canonicalProviderBytes.every((byte) => byte === 0)).toBe(
      true,
    )
  })

  it('rejects a same-length mutation of the actual outbound byte buffer', async () => {
    const outbound = vi.fn(async () => providerResponse())
    const harness = createConnectorHarness(outbound)
    const sentinelOffset = harness.invocation.canonicalProviderBytes.indexOf(
      'safe'.charCodeAt(0),
    )
    expect(sentinelOffset).toBeGreaterThanOrEqual(0)
    harness.invocation.canonicalProviderBytes[sentinelOffset] = 'f'.charCodeAt(0)
    const outcome = await harness.connector.invoke(
      harness.invocation,
      harness.grant,
      connectorOutputSchema,
      new AbortController().signal,
    )
    expect(outcome.disposition).toBe('no_dispatch')
    expect(outbound).not.toHaveBeenCalled()
    expect(harness.invocation.canonicalProviderBytes.every((byte) => byte === 0)).toBe(
      true,
    )
  })

  it('makes zero requests after binding mutation and one after retryable transport failure', async () => {
    const deniedOutbound = vi.fn(async () => providerResponse())
    const denied = createConnectorHarness(deniedOutbound)
    const mutated = { ...denied.grant, requestBindingHmac: `${'A'.repeat(42)}B` }
    const deniedOutcome = await denied.connector.invoke(
      denied.invocation,
      mutated,
      connectorOutputSchema,
      new AbortController().signal,
    )
    expect(deniedOutcome.disposition).toBe('no_dispatch')
    expect(deniedOutbound).not.toHaveBeenCalled()

    const ambiguousOutbound = vi.fn(async () => {
      throw new Error('connection reset')
    })
    const ambiguous = createConnectorHarness(ambiguousOutbound)
    const ambiguousOutcome = await ambiguous.connector.invoke(
      ambiguous.invocation,
      ambiguous.grant,
      connectorOutputSchema,
      new AbortController().signal,
    )
    expect(ambiguousOutcome.disposition).toBe('transport_ambiguous')
    expect(ambiguousOutbound).toHaveBeenCalledTimes(1)
  })
})
