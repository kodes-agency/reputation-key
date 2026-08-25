import { lookup as dnsLookup } from 'node:dns'
import { BlockList, isIP } from 'node:net'
import { createHash, timingSafeEqual, type KeyObject } from 'node:crypto'
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { Agent, request as undiciRequest, type Dispatcher } from 'undici'
import { z } from 'zod'
import { AI_OPERATION_PROFILES } from '../../src/shared/ai-operation-profiles'
import {
  explainJsonBytesRejection,
  parseAiExecutionGrant,
  parseAiInternalJsonBytes,
  parseAiProviderJsonBytes,
  verifyAiExecutionGrant,
  verifyAiRequestBinding,
  type AiExecutionGrantV1,
} from '../../src/shared/ai-internal-transport-contract'
import { canonicalizeRfc8785 } from '../../src/shared/merchant-ai-notice-contract'
import type { VersionedHmacKeyring } from '../../src/shared/security/versioned-hmac-keyring'
import {
  OPENAI_RESPONSES_URL,
  OPENAI_USER_AGENT,
  type OpenAiConnector,
  type OpenAiConnectorOutcome,
  type OpenAiUsageV1,
  type PreparedAiInvocation,
} from './contracts'
import {
  classifyOpenAiStatus,
  parseOpenAiJsonContentType,
  parseOpenAiRetryAfter,
} from './dispositions'
import { deriveOpenAiClientRequestId } from './prepared-invocation'

const PREPARED_DOMAIN = 'ai-prepared-v1\0'
const ZERO_USAGE: OpenAiUsageV1 = Object.freeze({
  inputTokens: 0,
  cachedTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
})

function connectorOutcome<T>(
  value: Omit<OpenAiConnectorOutcome<T>, 'reportedDisposition'> &
    Readonly<{ reportedDisposition?: OpenAiConnectorOutcome<T>['reportedDisposition'] }>,
): OpenAiConnectorOutcome<T> {
  return Object.freeze({
    ...value,
    reportedDisposition: value.reportedDisposition ?? value.disposition,
  })
}

export class AmbiguousOpenAiTransportError extends Error {
  constructor() {
    super('OpenAI transport outcome is ambiguous')
    this.name = 'AmbiguousOpenAiTransportError'
  }
}

export class InvalidOpenAiOutputError extends Error {
  readonly reason: string

  constructor(reason = 'unspecified') {
    super('OpenAI output is invalid')
    this.name = 'InvalidOpenAiOutputError'
    this.reason = reason
  }
}

export class InvalidOpenAiRequestError extends Error {
  constructor() {
    super('OpenAI request is invalid')
    this.name = 'InvalidOpenAiRequestError'
  }
}

// Canary-only diagnostic. The OpenAI SDK masks post-200 failures as
// `Connection error.`, which names neither the rejecting frame nor the
// underlying fault; the stack and the cause chain do.
function describeCanaryThrow(value: unknown, depth = 3): unknown {
  if (!(value instanceof Error))
    return value === undefined ? null : String(value).slice(0, 160)
  return {
    name: value.name,
    message: value.message.slice(0, 160),
    stack: (value.stack ?? '').slice(0, 1600),
    cause: depth > 0 ? describeCanaryThrow(value.cause, depth - 1) : null,
  }
}

export type OneShotOpenAiFetchState = {
  outboundFetchUsed: boolean
  completeStatus: number | null
  retryAfterSeconds: number | null
  decodedResponseBytes: Uint8Array | null
  sdkRequestBytes: Uint8Array | null
}

async function readBoundedResponse(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let chunkCount = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      chunks.push(next.value)
      chunkCount += 1
      if (next.value.byteLength === 0 || chunkCount > 1_024) {
        throw new AmbiguousOpenAiTransportError()
      }
      total += next.value.byteLength
      if (total > maxBytes) throw new AmbiguousOpenAiTransportError()
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  } catch (error) {
    try {
      await reader.cancel()
    } catch {
      // Cancellation failure does not weaken the ambiguous outcome.
    }
    if (error instanceof AmbiguousOpenAiTransportError) throw error
    throw new AmbiguousOpenAiTransportError()
  } finally {
    for (const chunk of chunks) chunk.fill(0)
    reader.releaseLock()
  }
}

function requestBodyBytes(body: BodyInit | null | undefined): Buffer {
  if (typeof body === 'string') return Buffer.from(body, 'utf8')
  if (body instanceof Uint8Array) return Buffer.from(body)
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body))
  throw new InvalidOpenAiRequestError()
}

function expectedPinnedSdkHeaders(apiKey: string): Readonly<Record<string, string>> {
  const os =
    process.platform === 'linux'
      ? 'Linux'
      : process.platform === 'darwin'
        ? 'MacOS'
        : null
  if (os === null || !['arm64', 'x64'].includes(process.arch)) {
    throw new InvalidOpenAiRequestError()
  }
  return Object.freeze({
    accept: 'application/json',
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
    'user-agent': 'OpenAI/JS 7.4.0',
    'x-stainless-arch': process.arch,
    'x-stainless-lang': 'js',
    'x-stainless-os': os,
    'x-stainless-package-version': '7.4.0',
    'x-stainless-retry-count': '0',
    'x-stainless-runtime': 'node',
    'x-stainless-runtime-version': process.version,
  })
}

function hasExactPinnedSdkHeaders(headers: Headers, apiKey: string): boolean {
  const expected = expectedPinnedSdkHeaders(apiKey)
  const actual = [...headers.entries()]
  const expectedEntries = Object.entries(expected)
  return (
    actual.length === expectedEntries.length &&
    expectedEntries.every(([name, value]) => headers.get(name) === value)
  )
}

function preparedBytesDigest(bytes: Uint8Array): Buffer {
  return createHash('sha256').update(PREPARED_DOMAIN, 'utf8').update(bytes).digest()
}
export function createOneShotOpenAiFetch(
  input: Readonly<{
    /** Route name; used only to attribute canary-only diagnostics. */
    route?: string
    apiKey: string
    permitId: string
    canonicalProviderBytes: Uint8Array
    responseBytes: number
    outboundFetch: typeof fetch
    signal: AbortSignal
  }>,
): Readonly<{
  fetch: typeof fetch
  state: OneShotOpenAiFetchState
  dispose(): void
}> {
  if (
    input.apiKey.length === 0 ||
    !Number.isSafeInteger(input.responseBytes) ||
    input.responseBytes < 1 ||
    input.responseBytes > 131_072
  ) {
    throw new InvalidOpenAiRequestError()
  }
  const state: OneShotOpenAiFetchState = {
    outboundFetchUsed: false,
    completeStatus: null,
    retryAfterSeconds: null,
    decodedResponseBytes: null,
    sdkRequestBytes: null,
  }
  const attestedByteCount = input.canonicalProviderBytes.byteLength
  const attestedDigest = preparedBytesDigest(input.canonicalProviderBytes)
  let fetchInvoked = false
  const fetchImpl: typeof fetch = async (requestInfo, init) => {
    if (fetchInvoked) {
      state.sdkRequestBytes?.fill(0)
      if (input.route === 'synthetic-canary') {
        const url =
          typeof requestInfo === 'string' || requestInfo instanceof URL
            ? String(requestInfo)
            : requestInfo.url
        process.stderr.write(
          `${JSON.stringify({
            event: 'canary_second_call_rejected',
            method:
              init?.method ??
              (requestInfo instanceof Request ? requestInfo.method : 'GET'),
            path: (() => {
              try {
                return new URL(url).pathname
              } catch {
                return 'unparseable'
              }
            })(),
          })}\n`,
        )
      }
      throw new InvalidOpenAiRequestError()
    }
    fetchInvoked = true
    const url =
      typeof requestInfo === 'string' || requestInfo instanceof URL
        ? new URL(requestInfo)
        : new URL(requestInfo.url)
    if (
      url.href !== OPENAI_RESPONSES_URL ||
      (init?.method ?? (requestInfo instanceof Request ? requestInfo.method : 'GET')) !==
        'POST' ||
      url.search.length > 0 ||
      input.signal.aborted
    ) {
      throw new InvalidOpenAiRequestError()
    }
    const incomingHeaders = new Headers(
      init?.headers ?? (requestInfo instanceof Request ? requestInfo.headers : undefined),
    )
    if (!hasExactPinnedSdkHeaders(incomingHeaders, input.apiKey)) {
      throw new InvalidOpenAiRequestError()
    }
    const sdkBytes = requestBodyBytes(init?.body)
    state.sdkRequestBytes = sdkBytes
    let parsed: unknown
    try {
      parsed = parseAiInternalJsonBytes(sdkBytes, 131_072, z.unknown())
    } catch {
      throw new InvalidOpenAiRequestError()
    }
    const emittedCanonical = Buffer.from(canonicalizeRfc8785(parsed), 'utf8')
    const expected = Buffer.from(input.canonicalProviderBytes)
    const same =
      emittedCanonical.byteLength === expected.byteLength &&
      timingSafeEqual(emittedCanonical, expected)
    emittedCanonical.fill(0)
    expected.fill(0)
    if (!same) throw new InvalidOpenAiRequestError()
    const dispatchDigest = preparedBytesDigest(input.canonicalProviderBytes)
    const dispatchBytesCurrent =
      input.canonicalProviderBytes.byteLength === attestedByteCount &&
      timingSafeEqual(dispatchDigest, attestedDigest)
    dispatchDigest.fill(0)
    if (!dispatchBytesCurrent) throw new InvalidOpenAiRequestError()

    const headers = new Headers({
      authorization: `Bearer ${input.apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': OPENAI_USER_AGENT,
      'x-client-request-id': deriveOpenAiClientRequestId(input.permitId),
    })
    state.outboundFetchUsed = true
    let response: Response
    const outboundBody = Buffer.from(input.canonicalProviderBytes)
    try {
      response = await input.outboundFetch(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers,
        body: outboundBody,
        redirect: 'manual',
        signal: input.signal,
      })
    } catch {
      throw new AmbiguousOpenAiTransportError()
    } finally {
      outboundBody.fill(0)
    }
    const bytes = await readBoundedResponse(response, input.responseBytes)
    state.decodedResponseBytes = bytes
    state.completeStatus = response.status
    state.retryAfterSeconds = parseOpenAiRetryAfter(response.headers.get('retry-after'))
    if (response.status === 200) {
      if (
        response.headers.has('content-encoding') ||
        !parseOpenAiJsonContentType(response.headers.get('content-type'))
      ) {
        throw new InvalidOpenAiOutputError(
          response.headers.has('content-encoding') ? 'content_encoding' : 'content_type',
        )
      }
      try {
        parseAiProviderJsonBytes(bytes, input.responseBytes, z.unknown())
      } catch {
        if (input.route === 'synthetic-canary') {
          process.stderr.write(
            `${JSON.stringify({
              event: 'canary_response_json_rejected',
              bytes: bytes.byteLength,
              contentType: response.headers.get('content-type'),
              explain: explainJsonBytesRejection(
                bytes,
                input.responseBytes,
                'finite-numbers',
              ),
            })}\n`,
          )
        }
        throw new InvalidOpenAiOutputError('response_json')
      }
      // A plain byte body, not a hand-rolled ReadableStream. The SDK clones the
      // response (which tees the stream and pulls both branches), and the old
      // stream errored on the second pull — the SDK reported that as
      // "Connection error." and the release canary surfaced it as
      // `output_invalid` after a perfectly good 200. Single delivery is already
      // guaranteed by the one-shot fetch gate and the grant nonce registry, so
      // the stream added fragility and no safety. The buffer is copied here and
      // the caller's copy is zeroed in its `finally`.
      return new Response(Buffer.from(bytes), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const retryHeaders = new Headers()
    if (state.retryAfterSeconds !== null) {
      retryHeaders.set('retry-after', String(state.retryAfterSeconds))
    }
    return new Response(null, { status: response.status, headers: retryHeaders })
  }
  return Object.freeze({
    fetch: fetchImpl,
    state,
    dispose: () => {
      state.decodedResponseBytes?.fill(0)
      state.sdkRequestBytes?.fill(0)
      state.decodedResponseBytes = null
      state.sdkRequestBytes = null
      attestedDigest.fill(0)
    },
  })
}

const FORBIDDEN_IPV4_ADDRESSES = new BlockList()
const FORBIDDEN_IPV6_ADDRESSES = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.31.196.0', 24],
  ['192.52.193.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['192.175.48.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  FORBIDDEN_IPV4_ADDRESSES.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 96],
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['100::', 64],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['3fff::', 20],
  ['5f00::', 16],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2620:4f:8000::', 48],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  FORBIDDEN_IPV6_ADDRESSES.addSubnet(network, prefix, 'ipv6')
}

export function isForbiddenOpenAiAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return FORBIDDEN_IPV4_ADDRESSES.check(address, 'ipv4')
  if (family === 6) return FORBIDDEN_IPV6_ADDRESSES.check(address, 'ipv6')
  return true
}

type OpenAiDnsLookupAll = (
  hostname: string,
  options: Readonly<{ all: true; verbatim: true }>,
  callback: (
    error: NodeJS.ErrnoException | null,
    addresses: readonly Readonly<{ address: string; family: number }>[],
  ) => void,
) => void

export function createRestrictedOpenAiLookup(
  lookupAll: OpenAiDnsLookupAll = dnsLookup as OpenAiDnsLookupAll,
) {
  return (
    hostname: string,
    options: Readonly<{ family?: number; all?: boolean }>,
    callback: (
      error: NodeJS.ErrnoException | null,
      address?: string | readonly Readonly<{ address: string; family: number }>[],
      family?: number,
    ) => void,
  ): void => {
    if (hostname !== 'api.openai.com') {
      callback(
        Object.assign(new Error('OpenAI DNS hostname is forbidden'), {
          code: 'EAI_FAIL',
        }),
      )
      return
    }
    lookupAll(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) {
        callback(error)
        return
      }
      if (
        addresses.length === 0 ||
        addresses.some(
          (entry) =>
            (entry.family !== 4 && entry.family !== 6) ||
            isForbiddenOpenAiAddress(entry.address),
        )
      ) {
        callback(
          Object.assign(new Error('OpenAI DNS resolution is forbidden'), {
            code: 'EAI_FAIL',
          }),
        )
        return
      }
      const selected = addresses.find(
        (entry) =>
          options.family === undefined ||
          options.family === 0 ||
          entry.family === options.family,
      )
      if (!selected) {
        callback(
          Object.assign(new Error('OpenAI DNS resolution is forbidden'), {
            code: 'EAI_FAIL',
          }),
        )
        return
      }
      if (options.all === true) callback(null, [selected])
      else callback(null, selected.address, selected.family)
    })
  }
}

type PinnedOpenAiOutbound = Readonly<{
  fetch: typeof fetch
  close(): Promise<void>
  destroy(): void
}>

function singleUndiciHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const value = headers[name]
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.join(', ')
  return null
}

/**
 * Fetch-compatible adapter for the one network primitive used by the OpenAI
 * connector. The destination remains compiled even when tests inject a
 * dispatcher that captures the actual HTTP/1.1 bytes.
 */
export function createPinnedOpenAiRequestFetch(dispatcher: Dispatcher): typeof fetch {
  return (async (requestInfo: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof requestInfo === 'string' || requestInfo instanceof URL
        ? new URL(requestInfo)
        : new URL(requestInfo.url)
    const method =
      init?.method ?? (requestInfo instanceof Request ? requestInfo.method : 'GET')
    if (
      url.href !== OPENAI_RESPONSES_URL ||
      method !== 'POST' ||
      init?.redirect !== 'manual'
    ) {
      throw new InvalidOpenAiRequestError()
    }
    const headers = new Headers(
      init?.headers ?? (requestInfo instanceof Request ? requestInfo.headers : undefined),
    )
    const bodyBytes = requestBodyBytes(
      init?.body ?? (requestInfo instanceof Request ? requestInfo.body : null),
    )
    let response: Awaited<ReturnType<typeof undiciRequest>>
    try {
      response = await undiciRequest(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: Object.fromEntries(headers.entries()),
        body: bodyBytes,
        signal: init?.signal ?? undefined,
        dispatcher,
      })
    } finally {
      bodyBytes.fill(0)
    }
    const responseHeaders = new Headers()
    for (const name of ['content-type', 'content-encoding', 'retry-after'] as const) {
      const value = singleUndiciHeader(response.headers, name)
      if (value !== null) responseHeaders.set(name, value)
    }
    const iterator = response.body[Symbol.asyncIterator]()
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await iterator.next()
          if (next.done) {
            controller.close()
            return
          }
          controller.enqueue(next.value)
        } catch (error) {
          response.body.destroy()
          controller.error(error)
        }
      },
      async cancel() {
        response.body.destroy()
        await iterator.return?.()
      },
    })
    return new Response(body, {
      status: response.statusCode,
      headers: responseHeaders,
    })
  }) as typeof fetch
}

export const PINNED_OPENAI_DISPATCHER_LIMITS = Object.freeze({
  // The byte-attestation and one-request isolation contract is HTTP/1.1.
  // Undici enables H2 negotiation by default, where pipelining and
  // maxRequestsPerClient do not enforce these HTTP/1-only bounds.
  allowH2: false,
  connections: 1,
  pipelining: 0,
  maxRequestsPerClient: 1,
  keepAliveTimeout: 1,
  keepAliveMaxTimeout: 1,
} as const)

function createPinnedOpenAiOutboundFetch(): PinnedOpenAiOutbound {
  const restrictedLookup = createRestrictedOpenAiLookup()
  const dispatcher = new Agent({
    ...PINNED_OPENAI_DISPATCHER_LIMITS,
    connect: {
      servername: 'api.openai.com',
      minVersion: 'TLSv1.2',
      maxCachedSessions: 0,
      autoSelectFamily: false,
      lookup: restrictedLookup as never,
    },
  })
  let closePromise: Promise<void> | null = null
  const requestFetch = createPinnedOpenAiRequestFetch(dispatcher)
  return Object.freeze({
    fetch: requestFetch,
    close: () => {
      closePromise ??= dispatcher.close()
      return closePromise
    },
    destroy: () => dispatcher.destroy(),
  })
}

function inputTokenCeiling(invocation: PreparedAiInvocation): number | null {
  const operationProfileVersion =
    invocation.descriptor.subjectKind === 'property'
      ? invocation.descriptor.binding.operationProfileVersion
      : invocation.descriptor.canaryBinding.operationProfileVersion
  const profile = AI_OPERATION_PROFILES.find(
    (candidate) =>
      candidate.profileVersion === operationProfileVersion &&
      candidate.sourceRoute === invocation.descriptor.route,
  )
  if (profile === undefined) return null
  const ceiling =
    profile.staticTokenBearingBytes + invocation.descriptor.providerPayloadByteCount
  return Number.isSafeInteger(ceiling) ? ceiling : null
}

/**
 * A rejected usage block is reported for the SYNTHETIC-CANARY route only, where
 * the corpus is synthetic and the operator is holding a release gate: naming the
 * failed invariant (and its counts) is the difference between a diagnosable gate
 * and an unactionable `output_invalid`. Tenant routes stay silent.
 */
function usageRejected(
  invocation: PreparedAiInvocation,
  invariant: string,
  counts?: Readonly<Record<string, number>>,
): null {
  if (invocation.descriptor.route === 'synthetic-canary') {
    process.stderr.write(
      `${JSON.stringify({ event: 'canary_usage_rejected', invariant, ...(counts ?? {}) })}\n`,
    )
  }
  return null
}

function parseUsage(
  value: unknown,
  invocation: PreparedAiInvocation,
): OpenAiUsageV1 | null {
  // `input_tokens_details` / `output_tokens_details` are optional in the
  // Responses payload. Requiring them classified an otherwise successful,
  // fully-accounted call as `output_invalid` with usage unknown, which failed
  // the release gate for a provider-shape difference rather than a real fault.
  // Absent sub-counters default to 0; every inequality below still holds
  // because 0 can only make the checks stricter.
  const parsed = z
    .object({
      input_tokens: z.number().int().nonnegative().safe(),
      input_tokens_details: z
        .object({ cached_tokens: z.number().int().nonnegative().safe().default(0) })
        .passthrough()
        .default({ cached_tokens: 0 }),
      output_tokens: z.number().int().nonnegative().safe(),
      output_tokens_details: z
        .object({ reasoning_tokens: z.number().int().nonnegative().safe().default(0) })
        .passthrough()
        .default({ reasoning_tokens: 0 }),
      total_tokens: z.number().int().nonnegative().safe(),
    })
    .passthrough()
    .safeParse(value)
  if (!parsed.success) return usageRejected(invocation, 'usage_shape')
  const maximumInputTokens = inputTokenCeiling(invocation)
  if (maximumInputTokens === null)
    return usageRejected(invocation, 'input_ceiling_unknown')
  const usage = parsed.data
  const violated =
    usage.input_tokens_details.cached_tokens > usage.input_tokens
      ? 'cached_above_input'
      : usage.output_tokens_details.reasoning_tokens > usage.output_tokens
        ? 'reasoning_above_output'
        : usage.total_tokens !== usage.input_tokens + usage.output_tokens
          ? 'total_mismatch'
          : usage.output_tokens > invocation.descriptor.limits.outputTokens
            ? 'output_above_limit'
            : usage.input_tokens > maximumInputTokens
              ? 'input_above_ceiling'
              : null
  if (violated !== null) {
    return usageRejected(invocation, violated, {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      reasoningTokens: usage.output_tokens_details.reasoning_tokens,
      totalTokens: usage.total_tokens,
      outputLimit: invocation.descriptor.limits.outputTokens,
      inputCeiling: maximumInputTokens,
    })
  }
  return Object.freeze({
    inputTokens: usage.input_tokens,
    cachedTokens: usage.input_tokens_details.cached_tokens,
    outputTokens: usage.output_tokens,
    reasoningTokens: usage.output_tokens_details.reasoning_tokens,
    totalTokens: usage.total_tokens,
  })
}

export function hasOfficialOpenAiRefusal(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const output = (value as Readonly<{ output?: unknown }>).output
  if (!Array.isArray(output)) return false
  return output.some((item) => {
    if (typeof item !== 'object' || item === null) return false
    const message = item as Readonly<{ type?: unknown; content?: unknown }>
    if (message.type !== 'message' || !Array.isArray(message.content)) return false
    return message.content.some(
      (part) =>
        typeof part === 'object' &&
        part !== null &&
        (part as Readonly<{ type?: unknown }>).type === 'refusal' &&
        typeof (part as Readonly<{ refusal?: unknown }>).refusal === 'string',
    )
  })
}

class GrantNonceRegistry {
  readonly #entries = new Map<string, number>()

  consume(nonce: string, expiresAtEpochMillis: number, now: number): boolean {
    for (const [key, expiry] of this.#entries) {
      if (expiry <= now) this.#entries.delete(key)
    }
    if (this.#entries.has(nonce) || this.#entries.size >= 8_192) return false
    this.#entries.set(nonce, expiresAtEpochMillis)
    return true
  }
}

function invocationAttestationIsCurrent(
  invocation: PreparedAiInvocation,
  grant: AiExecutionGrantV1,
  requestBindingKeys: VersionedHmacKeyring,
  admissionPublicKeys: ReadonlyMap<string, KeyObject>,
): boolean {
  const parsedGrant = parseAiExecutionGrant(grant)
  const canonical = Buffer.from(canonicalizeRfc8785(invocation.sdkRequest), 'utf8')
  const outboundBytes = Buffer.from(invocation.canonicalProviderBytes)
  let digest: string
  let exactOutboundBytes: boolean
  try {
    digest = createHash('sha256')
      .update(PREPARED_DOMAIN, 'utf8')
      .update(canonical)
      .digest('hex')
    exactOutboundBytes =
      canonical.byteLength === outboundBytes.byteLength &&
      timingSafeEqual(canonical, outboundBytes)
  } finally {
    canonical.fill(0)
    outboundBytes.fill(0)
  }
  return (
    verifyAiExecutionGrant(parsedGrant, admissionPublicKeys) &&
    exactOutboundBytes &&
    invocation.descriptor.preparedByteCount ===
      invocation.canonicalProviderBytes.byteLength &&
    invocation.descriptor.preparedDigest === digest &&
    parsedGrant.subjectKind === invocation.descriptor.subjectKind &&
    parsedGrant.route === invocation.descriptor.route &&
    parsedGrant.operationId === invocation.descriptor.operationId &&
    parsedGrant.permitId === invocation.descriptor.permitId &&
    parsedGrant.attemptNumber === invocation.descriptor.attemptNumber &&
    verifyAiRequestBinding(
      {
        descriptor: invocation.descriptor,
        requestBindingKeyId: invocation.requestBindingKeyId,
        requestBindingHmac: invocation.requestBindingHmac,
      },
      requestBindingKeys,
    ) &&
    parsedGrant.requestBindingKeyId === invocation.requestBindingKeyId &&
    parsedGrant.requestBindingHmac === invocation.requestBindingHmac &&
    canonicalizeRfc8785(parsedGrant.limits) ===
      canonicalizeRfc8785(invocation.descriptor.limits) &&
    parsedGrant.callerDeadlineEpochMillis ===
      invocation.descriptor.callerDeadlineEpochMillis
  )
}

// `invocationAttestationIsCurrent` folds twelve independent checks into one
// boolean, and the caller turns a false into a silent `no_dispatch` — no log, no
// code, no provider call. From the outside that is indistinguishable from a
// deadline abort or a dead outbound boundary, which cost a full debugging cycle on
// the closed beta. This names the failing check. It runs ONLY on the failure path,
// so the happy path is untouched, and it emits identifiers and booleans only —
// never key material, never provider bytes.
function describeAttestationFailure(
  invocation: PreparedAiInvocation,
  grant: AiExecutionGrantV1,
  requestBindingKeys: VersionedHmacKeyring,
  admissionPublicKeys: ReadonlyMap<string, KeyObject>,
): readonly string[] {
  const reasons: string[] = []
  let parsedGrant: AiExecutionGrantV1
  try {
    parsedGrant = parseAiExecutionGrant(grant)
  } catch {
    return Object.freeze(['grant_unparseable'])
  }
  const canonical = Buffer.from(canonicalizeRfc8785(invocation.sdkRequest), 'utf8')
  const outboundBytes = Buffer.from(invocation.canonicalProviderBytes)
  let digest: string
  let exactOutboundBytes: boolean
  try {
    digest = createHash('sha256')
      .update(PREPARED_DOMAIN, 'utf8')
      .update(canonical)
      .digest('hex')
    exactOutboundBytes =
      canonical.byteLength === outboundBytes.byteLength &&
      timingSafeEqual(canonical, outboundBytes)
  } finally {
    canonical.fill(0)
    outboundBytes.fill(0)
  }
  if (!verifyAiExecutionGrant(parsedGrant, admissionPublicKeys)) {
    reasons.push('grant_signature_unverified')
  }
  if (!exactOutboundBytes) reasons.push('outbound_bytes_differ')
  if (
    invocation.descriptor.preparedByteCount !==
    invocation.canonicalProviderBytes.byteLength
  ) {
    reasons.push('prepared_byte_count_mismatch')
  }
  if (invocation.descriptor.preparedDigest !== digest) {
    reasons.push('prepared_digest_mismatch')
  }
  if (parsedGrant.subjectKind !== invocation.descriptor.subjectKind) {
    reasons.push('subject_kind_mismatch')
  }
  if (parsedGrant.route !== invocation.descriptor.route) reasons.push('route_mismatch')
  if (parsedGrant.operationId !== invocation.descriptor.operationId) {
    reasons.push('operation_id_mismatch')
  }
  if (parsedGrant.permitId !== invocation.descriptor.permitId) {
    reasons.push('permit_id_mismatch')
  }
  if (parsedGrant.attemptNumber !== invocation.descriptor.attemptNumber) {
    reasons.push('attempt_mismatch')
  }
  if (
    !verifyAiRequestBinding(
      {
        descriptor: invocation.descriptor,
        requestBindingKeyId: invocation.requestBindingKeyId,
        requestBindingHmac: invocation.requestBindingHmac,
      },
      requestBindingKeys,
    )
  ) {
    reasons.push('request_binding_unverified')
  }
  if (parsedGrant.requestBindingKeyId !== invocation.requestBindingKeyId) {
    reasons.push('request_binding_key_id_mismatch')
  }
  if (parsedGrant.requestBindingHmac !== invocation.requestBindingHmac) {
    reasons.push('request_binding_hmac_mismatch')
  }
  if (
    canonicalizeRfc8785(parsedGrant.limits) !==
    canonicalizeRfc8785(invocation.descriptor.limits)
  ) {
    reasons.push('limits_mismatch')
  }
  if (
    parsedGrant.callerDeadlineEpochMillis !==
    invocation.descriptor.callerDeadlineEpochMillis
  ) {
    reasons.push('caller_deadline_mismatch')
  }
  return Object.freeze(
    reasons.length === 0 ? ['attestation_current_on_recheck'] : reasons,
  )
}

async function closePinnedOutbound(outbound: PinnedOpenAiOutbound): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      outbound.close(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('OpenAI dispatcher close timed out')),
          1_000,
        )
        timer.unref()
      }),
    ])
    return true
  } catch {
    outbound.destroy()
    return false
  } finally {
    clearTimeout(timer)
  }
}
export function createOpenAiConnector(
  dependencies: Readonly<{
    apiKey: string
    requestBindingKeys: VersionedHmacKeyring
    admissionPublicKeys: ReadonlyMap<string, KeyObject>
    outboundFetch?: typeof fetch
    now?: () => number
    pinnedOutboundFactory?: () => PinnedOpenAiOutbound
  }>,
): OpenAiConnector {
  if (dependencies.apiKey.length === 0) throw new Error('OPENAI_API_KEY is required')
  const nonceRegistry = new GrantNonceRegistry()
  const now = dependencies.now ?? Date.now
  let cleanupHealthy = true
  return Object.freeze({
    invoke: async (
      invocation: PreparedAiInvocation,
      grant: AiExecutionGrantV1,
      outputSchema: z.ZodTypeAny,
      signal: AbortSignal,
    ): Promise<OpenAiConnectorOutcome<unknown>> => {
      let currentTime: number
      try {
        currentTime = now()
        // Evaluate the six gates separately so the log can name the one that
        // fired. Nonce consumption stays LAST and is only reached when every other
        // gate passed, so a diagnostic can never burn a nonce that would otherwise
        // have dispatched.
        const attestationCurrent = invocationAttestationIsCurrent(
          invocation,
          grant,
          dependencies.requestBindingKeys,
          dependencies.admissionPublicKeys,
        )
        const grantTimingReasons: string[] = []
        if (
          grant.expiresAtEpochMillis !== invocation.descriptor.callerDeadlineEpochMillis
        ) {
          grantTimingReasons.push('grant_expiry_not_caller_deadline')
        }
        if (grant.issuedAtEpochMillis >= grant.expiresAtEpochMillis) {
          grantTimingReasons.push('grant_issued_after_expiry')
        }
        if (grant.issuedAtEpochMillis > currentTime)
          grantTimingReasons.push('grant_issued_in_future')
        if (grant.expiresAtEpochMillis <= currentTime)
          grantTimingReasons.push('grant_expired')
        const nonceAccepted =
          attestationCurrent &&
          grantTimingReasons.length === 0 &&
          nonceRegistry.consume(grant.nonce, grant.expiresAtEpochMillis, currentTime)
        if (!attestationCurrent || grantTimingReasons.length > 0 || !nonceAccepted) {
          const reasons = [
            ...(attestationCurrent
              ? []
              : describeAttestationFailure(
                  invocation,
                  grant,
                  dependencies.requestBindingKeys,
                  dependencies.admissionPublicKeys,
                )),
            ...grantTimingReasons,
            ...(attestationCurrent && grantTimingReasons.length === 0 && !nonceAccepted
              ? ['nonce_replayed']
              : []),
          ]
          process.stderr.write(
            `${JSON.stringify({
              event: 'gateway_no_dispatch',
              route: invocation.descriptor.route,
              operationId: invocation.descriptor.operationId,
              permitId: invocation.descriptor.permitId,
              attempt: invocation.descriptor.attemptNumber,
              grantTtlMillis: grant.expiresAtEpochMillis - currentTime,
              reasons,
            })}\n`,
          )
          invocation.canonicalProviderBytes.fill(0)
          return connectorOutcome({
            disposition: 'no_dispatch',
            result: null,
            usageKnown: false,
            providerRetryable: false,
            usage: ZERO_USAGE,
            retryAfterSeconds: null,
            outboundFetchUsed: false,
          })
        }
      } catch (error) {
        // Swallowing this made an attestation crash look identical to a clean
        // "declined to dispatch". Name it.
        process.stderr.write(
          `${JSON.stringify({
            event: 'gateway_no_dispatch',
            stage: 'attestation_threw',
            route: invocation.descriptor.route,
            operationId: invocation.descriptor.operationId,
            errorName: error instanceof Error ? error.name : 'unknown',
            errorMessage:
              error instanceof Error
                ? error.message.slice(0, 200)
                : String(error).slice(0, 200),
          })}\n`,
        )
        invocation.canonicalProviderBytes.fill(0)
        return connectorOutcome({
          disposition: 'no_dispatch',
          result: null,
          usageKnown: false,
          providerRetryable: false,
          usage: ZERO_USAGE,
          retryAfterSeconds: null,
          outboundFetchUsed: false,
        })
      }
      let pinned: PinnedOpenAiOutbound | null = null
      let boundary: ReturnType<typeof createOneShotOpenAiFetch> | null = null
      try {
        pinned = dependencies.outboundFetch
          ? null
          : (dependencies.pinnedOutboundFactory ?? createPinnedOpenAiOutboundFetch)()
        const outboundFetch = dependencies.outboundFetch ?? pinned?.fetch
        if (outboundFetch === undefined) throw new InvalidOpenAiRequestError()
        boundary = createOneShotOpenAiFetch({
          route: invocation.descriptor.route,
          apiKey: dependencies.apiKey,
          permitId: grant.permitId,
          canonicalProviderBytes: invocation.canonicalProviderBytes,
          responseBytes: grant.limits.responseBytes,
          outboundFetch,
          signal,
        })
        const client = new OpenAI({
          apiKey: dependencies.apiKey,
          baseURL: 'https://api.openai.com/v1',
          organization: null,
          project: null,
          maxRetries: 0,
          fetch: boundary.fetch,
          logLevel: 'off',
          logger: { error() {}, warn() {}, info() {}, debug() {} },
        })
        const parseableFormat = zodTextFormat(
          outputSchema,
          invocation.sdkRequest.text.format.name,
        )
        const parseableWireFormat = Object.freeze({
          type: parseableFormat.type,
          name: parseableFormat.name,
          strict: parseableFormat.strict,
          schema: parseableFormat.schema,
        })
        if (
          canonicalizeRfc8785(parseableWireFormat) !==
          canonicalizeRfc8785(invocation.sdkRequest.text.format)
        ) {
          throw new InvalidOpenAiRequestError()
        }
        const response = await client.responses.parse(
          {
            ...invocation.sdkRequest,
            input: invocation.sdkRequest.input.map((message) => ({ ...message })),
            text: { format: parseableFormat },
            tools: [],
          },
          { signal },
        )
        const reportedRefusal = hasOfficialOpenAiRefusal(response)
        const usage = parseUsage(response.usage, invocation)
        if (!usage) {
          return connectorOutcome({
            disposition: 'output_invalid',
            reportedDisposition: reportedRefusal ? 'provider_refused' : 'success',
            result: null,
            usageKnown: false,
            providerRetryable: false,
            usage: ZERO_USAGE,
            retryAfterSeconds: null,
            outboundFetchUsed: true,
          })
        }
        if (reportedRefusal) {
          return connectorOutcome({
            disposition: 'provider_refused',
            result: null,
            usageKnown: true,
            providerRetryable: false,
            usage,
            retryAfterSeconds: null,
            outboundFetchUsed: true,
          })
        }
        // A truncated response is a successful, fully-billed provider call that
        // returns an EMPTY body, so `outputSchema.safeParse` below fails. It used
        // to report a bare `output_invalid`, indistinguishable from a malformed
        // answer, and that is what hid a global reasoning-effort fault: every
        // tenant route spent its entire output budget on reasoning and returned
        // nothing, while the operator saw only four words.
        //
        // Content-free by construction: a provider enum and three integers. No
        // tenant text, so unlike `usageRejected` this is safe on every route.
        const truncated =
          response.status === 'incomplete' || Boolean(response.incomplete_details)
        if (truncated) {
          process.stderr.write(
            `${JSON.stringify({
              event: 'openai_output_truncated',
              route: invocation.descriptor.route,
              reason: response.incomplete_details?.reason ?? 'unknown',
              outputTokens: usage.outputTokens,
              reasoningTokens: usage.reasoningTokens,
              maxOutputTokens: invocation.sdkRequest.max_output_tokens,
            })}\n`,
          )
        }
        // The parse decides whether the answer is usable; truncation decides how
        // an unusable one is NAMED. The two can never disagree in practice: the
        // SDK parses only when `status === 'completed'`
        // (openai/lib/ResponsesParser.js `shouldParse`), so an incomplete
        // response always arrives with `output_parsed` null however much text it
        // carries. That is also what keeps a partial answer from escaping.
        const parsedOutput = outputSchema.safeParse(response.output_parsed)
        if (!parsedOutput.success) {
          return connectorOutcome({
            disposition: truncated ? 'output_truncated' : 'output_invalid',
            reportedDisposition: 'success',
            result: null,
            usageKnown: true,
            providerRetryable: false,
            usage,
            retryAfterSeconds: null,
            outboundFetchUsed: true,
          })
        }
        return connectorOutcome({
          disposition: 'success',
          result: parsedOutput.data,
          usageKnown: true,
          providerRetryable: false,
          usage,
          retryAfterSeconds: null,
          outboundFetchUsed: true,
        })
      } catch (error) {
        if (
          boundary !== null &&
          boundary.state.completeStatus !== null &&
          boundary.state.completeStatus !== 200
        ) {
          const classified = classifyOpenAiStatus(boundary.state.completeStatus)
          return connectorOutcome({
            disposition: classified.disposition,
            result: null,
            usageKnown: false,
            providerRetryable: classified.retryable,
            usage: ZERO_USAGE,
            retryAfterSeconds: classified.retryable
              ? boundary.state.retryAfterSeconds
              : null,
            outboundFetchUsed: true,
          })
        }
        if (boundary === null || !boundary.state.outboundFetchUsed) {
          // The dispatch threw before any byte left the process. Discarding the
          // error here is what made a broken pinned-outbound path look like a
          // deliberate no-dispatch.
          process.stderr.write(
            `${JSON.stringify({
              event: 'gateway_no_dispatch',
              stage: 'dispatch_threw_before_outbound',
              route: invocation.descriptor.route,
              operationId: invocation.descriptor.operationId,
              pinnedNull: pinned === null,
              boundaryNull: boundary === null,
              errorName: error instanceof Error ? error.name : 'unknown',
              errorMessage:
                error instanceof Error
                  ? error.message.slice(0, 300)
                  : String(error).slice(0, 300),
            })}\n`,
          )
          return connectorOutcome({
            disposition: 'no_dispatch',
            result: null,
            usageKnown: false,
            providerRetryable: false,
            usage: ZERO_USAGE,
            retryAfterSeconds: null,
            outboundFetchUsed: false,
          })
        }
        if (signal.aborted) {
          const disposition =
            signal.reason === 'provider_deadline' ? 'deadline_exceeded' : 'caller_aborted'
          return connectorOutcome({
            disposition,
            result: null,
            usageKnown: false,
            providerRetryable: false,
            usage: ZERO_USAGE,
            retryAfterSeconds: null,
            outboundFetchUsed: true,
          })
        }
        if (error instanceof InvalidOpenAiOutputError) {
          if (invocation.descriptor.route === 'synthetic-canary') {
            process.stderr.write(
              `${JSON.stringify({ event: 'canary_output_invalid', reason: error.reason })}\n`,
            )
          }
          return connectorOutcome({
            disposition: 'output_invalid',
            reportedDisposition: 'success',
            result: null,
            usageKnown: false,
            providerRetryable: false,
            usage: ZERO_USAGE,
            retryAfterSeconds: null,
            outboundFetchUsed: true,
          })
        }
        if (boundary !== null && boundary.state.completeStatus === 200) {
          if (invocation.descriptor.route === 'synthetic-canary') {
            process.stderr.write(
              `${JSON.stringify({ event: 'canary_output_invalid', reason: 'post_200_throw', error: describeCanaryThrow(error) })}\n`,
            )
          }
          return connectorOutcome({
            disposition: 'output_invalid',
            reportedDisposition: 'success',
            result: null,
            usageKnown: false,
            providerRetryable: false,
            usage: ZERO_USAGE,
            retryAfterSeconds: null,
            outboundFetchUsed: true,
          })
        }
        return connectorOutcome({
          disposition: 'transport_ambiguous',
          result: null,
          usageKnown: false,
          providerRetryable: false,
          usage: ZERO_USAGE,
          retryAfterSeconds: null,
          outboundFetchUsed: true,
        })
      } finally {
        boundary?.dispose()
        invocation.canonicalProviderBytes.fill(0)
        if (pinned !== null && !(await closePinnedOutbound(pinned)))
          cleanupHealthy = false
      }
    },
    readiness: () => cleanupHealthy,
  })
}
