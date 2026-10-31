import { createHash, timingSafeEqual, type KeyObject } from 'node:crypto'
import { lookup as dnsLookup } from 'node:dns'
import { BlockList, isIP } from 'node:net'
import { Agent, request as undiciRequest, type Dispatcher } from 'undici'
import { REPLY_STREAM_RESPONSE_MAX_BYTES } from '#/shared/ai-openai-stream-profile'
import { boundedProviderEventStream } from './bounded-event-stream'
import { z } from 'zod/v4'
import {
  parseAiInternalJsonBytes,
  parseAiProviderJsonBytes,
  parseAiExecutionGrant,
  verifyAiExecutionGrant,
  verifyAiRequestBinding,
  type AiExecutionGrantV1,
} from '#/shared/ai-internal-transport-contract'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { PreparedInvocationBase } from './provider-contracts'
import type {
  AiProviderOutcome,
  AiProviderUsage,
  OneShotProviderFetchState,
} from './provider-contracts'
export type { OneShotProviderFetchState } from './provider-contracts'

const PREPARED_DOMAIN = 'ai-prepared-v1\0'

export type ProviderBoundaryInvocation = PreparedInvocationBase &
  Readonly<{ sdkRequest: unknown }>

export type ProviderDnsLookupAll = (
  hostname: string,
  options: Readonly<{ all: true; verbatim: true }>,
  callback: (
    error: NodeJS.ErrnoException | null,
    addresses: readonly Readonly<{ address: string; family: number }>[],
  ) => void,
) => void

export type PinnedProviderOutbound = Readonly<{
  fetch: typeof fetch
  close(): Promise<void>
  destroy(): void
}>

export const PROVIDER_ZERO_USAGE: AiProviderUsage = Object.freeze({
  inputTokens: 0,
  cachedTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
})

export function providerConnectorOutcome<T>(
  value: Omit<AiProviderOutcome<T>, 'reportedDisposition'> &
    Readonly<{ reportedDisposition?: AiProviderOutcome<T>['reportedDisposition'] }>,
): AiProviderOutcome<T> {
  return Object.freeze({
    ...value,
    reportedDisposition: value.reportedDisposition ?? value.disposition,
  })
}

export function providerNoDispatchOutcome(): AiProviderOutcome<unknown> {
  return providerConnectorOutcome({
    disposition: 'no_dispatch',
    result: null,
    usageKnown: false,
    providerRetryable: false,
    usage: PROVIDER_ZERO_USAGE,
    retryAfterSeconds: null,
    outboundFetchUsed: false,
  })
}

export const PINNED_PROVIDER_DISPATCHER_LIMITS = Object.freeze({
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

function preparedProviderBytesDigest(bytes: Uint8Array): Buffer {
  return createHash('sha256').update(PREPARED_DOMAIN, 'utf8').update(bytes).digest()
}

function providerHeadersAreExact(
  headers: Headers,
  expected: Readonly<Record<string, string>>,
): boolean {
  const entries = Object.entries(expected)
  return (
    [...headers.entries()].length === entries.length &&
    entries.every(([name, value]) => headers.get(name) === value)
  )
}

function providerFetchRequestFacts(
  requestInfo: string | URL | Request,
  init?: RequestInit,
): Readonly<{ url: URL; method: string }> {
  return {
    url:
      typeof requestInfo === 'string' || requestInfo instanceof URL
        ? new URL(requestInfo)
        : new URL(requestInfo.url),
    method: init?.method ?? (requestInfo instanceof Request ? requestInfo.method : 'GET'),
  }
}

type OneShotProviderFetchInput = Readonly<{
  apiKey: string
  url: string
  canonicalProviderBytes: Uint8Array
  responseBytes: number
  outboundFetch: typeof fetch
  signal: AbortSignal
  expectedSdkHeaders(apiKey: string): Readonly<Record<string, string>>
  outboundHeaders(): Headers
  invalidError(): Error
  ambiguousError(): Error
  invalidOutputError(reason: string): Error
  parseRetryAfter(value: string | null): number | null
  validJsonContentType(value: string | null): boolean
  eventStream?: boolean
  onDispatch?(): void
  onSecondInvocation?(requestInfo: string | URL | Request, init?: RequestInit): void
  onInvalidJson?(bytes: Uint8Array, response: Response): void
}>

function verifyOneShotSdkRequest(
  input: OneShotProviderFetchInput,
  state: OneShotProviderFetchState,
  requestInfo: string | URL | Request,
  init: RequestInit | undefined,
  attestedByteCount: number,
  attestedDigest: Uint8Array,
): void {
  const { url, method } = providerFetchRequestFacts(requestInfo, init)
  if (
    url.href !== input.url ||
    url.search.length > 0 ||
    method !== 'POST' ||
    input.signal.aborted
  ) {
    throw input.invalidError()
  }
  const sdkHeaders = new Headers(
    init?.headers ?? (requestInfo instanceof Request ? requestInfo.headers : undefined),
  )
  if (!providerHeadersAreExact(sdkHeaders, input.expectedSdkHeaders(input.apiKey))) {
    throw input.invalidError()
  }
  const sdkBytes = providerRequestBodyBytes(init?.body, input.invalidError)
  state.sdkRequestBytes = sdkBytes
  let parsed: unknown
  try {
    parsed = parseAiInternalJsonBytes(sdkBytes, 131_072, z.unknown())
  } catch {
    throw input.invalidError()
  }
  const emittedCanonical = Buffer.from(canonicalizeRfc8785(parsed), 'utf8')
  const expected = Buffer.from(input.canonicalProviderBytes)
  const same =
    emittedCanonical.byteLength === expected.byteLength &&
    timingSafeEqual(emittedCanonical, expected)
  emittedCanonical.fill(0)
  expected.fill(0)
  if (!same) throw input.invalidError()
  const dispatchDigest = preparedProviderBytesDigest(input.canonicalProviderBytes)
  const dispatchBytesCurrent =
    input.canonicalProviderBytes.byteLength === attestedByteCount &&
    timingSafeEqual(dispatchDigest, attestedDigest)
  dispatchDigest.fill(0)
  if (!dispatchBytesCurrent) throw input.invalidError()
}

async function dispatchOneShotProviderRequest(
  input: OneShotProviderFetchInput,
  headers: Headers,
): Promise<Response> {
  const outboundBody = Buffer.from(input.canonicalProviderBytes)
  try {
    return await input.outboundFetch(input.url, {
      method: 'POST',
      headers,
      body: outboundBody,
      redirect: 'manual',
      signal: input.signal,
    })
  } catch {
    throw input.ambiguousError()
  } finally {
    outboundBody.fill(0)
  }
}

function responseForProviderSdk(
  input: OneShotProviderFetchInput,
  state: OneShotProviderFetchState,
  response: Response,
  bytes: Uint8Array,
): Response {
  if (response.status !== 200) {
    const headers = new Headers()
    if (state.retryAfterSeconds !== null) {
      headers.set('retry-after', String(state.retryAfterSeconds))
    }
    return new Response(null, { status: response.status, headers })
  }
  if (
    response.headers.has('content-encoding') ||
    !input.validJsonContentType(response.headers.get('content-type'))
  ) {
    throw input.invalidOutputError(
      response.headers.has('content-encoding') ? 'content_encoding' : 'content_type',
    )
  }
  try {
    parseAiProviderJsonBytes(bytes, input.responseBytes, z.unknown())
  } catch {
    input.onInvalidJson?.(bytes, response)
    throw input.invalidOutputError('response_json')
  }
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

export function createOneShotProviderFetch(input: OneShotProviderFetchInput): Readonly<{
  fetch: typeof fetch
  state: OneShotProviderFetchState
  dispose(): void
}> {
  if (
    input.apiKey.length === 0 ||
    !Number.isSafeInteger(input.responseBytes) ||
    input.responseBytes < 1 ||
    input.responseBytes > (input.eventStream ? REPLY_STREAM_RESPONSE_MAX_BYTES : 131_072)
  ) {
    throw input.invalidError()
  }
  const state: OneShotProviderFetchState = {
    outboundFetchUsed: false,
    completeStatus: null,
    retryAfterSeconds: null,
    decodedResponseBytes: null,
    sdkRequestBytes: null,
  }
  const attestedByteCount = input.canonicalProviderBytes.byteLength
  const attestedDigest = preparedProviderBytesDigest(input.canonicalProviderBytes)
  let fetchInvoked = false
  const fetchImpl: typeof fetch = async (requestInfo, init) => {
    if (fetchInvoked) {
      state.sdkRequestBytes?.fill(0)
      input.onSecondInvocation?.(requestInfo, init)
      throw input.invalidError()
    }
    fetchInvoked = true
    verifyOneShotSdkRequest(
      input,
      state,
      requestInfo,
      init,
      attestedByteCount,
      attestedDigest,
    )
    // Built before the flag: a header that cannot be derived is a request that was
    // never sent, not an ambiguous one.
    const outboundHeaders = input.outboundHeaders()
    state.outboundFetchUsed = true
    const dispatched = dispatchOneShotProviderRequest(input, outboundHeaders)
    input.onDispatch?.()
    const response = await dispatched
    if (input.eventStream && response.status === 200) {
      state.completeStatus = response.status
      return boundedProviderEventStream(
        response,
        input.responseBytes,
        input.invalidOutputError,
      )
    }
    const bytes = await readBoundedProviderResponse(
      response,
      input.responseBytes,
      input.ambiguousError,
    )
    state.decodedResponseBytes = bytes
    state.completeStatus = response.status
    state.retryAfterSeconds = input.parseRetryAfter(response.headers.get('retry-after'))
    return responseForProviderSdk(input, state, response, bytes)
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

export function isForbiddenProviderAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return FORBIDDEN_IPV4_ADDRESSES.check(address, 'ipv4')
  if (family === 6) return FORBIDDEN_IPV6_ADDRESSES.check(address, 'ipv6')
  return true
}

export function createRestrictedProviderLookup(
  input: Readonly<{
    hostname: string
    label: string
    lookupAll?: ProviderDnsLookupAll
  }>,
) {
  const lookupAll = input.lookupAll ?? (dnsLookup as ProviderDnsLookupAll)
  return (
    hostname: string,
    options: Readonly<{ family?: number; all?: boolean }>,
    callback: (
      error: NodeJS.ErrnoException | null,
      address?: string | readonly Readonly<{ address: string; family: number }>[],
      family?: number,
    ) => void,
  ): void => {
    if (hostname !== input.hostname) {
      callback(
        Object.assign(new Error(`${input.label} DNS hostname is forbidden`), {
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
      const invalid =
        addresses.length === 0 ||
        addresses.some(
          (entry) =>
            (entry.family !== 4 && entry.family !== 6) ||
            isForbiddenProviderAddress(entry.address),
        )
      const selected = invalid
        ? undefined
        : addresses.find(
            (entry) =>
              options.family === undefined ||
              options.family === 0 ||
              entry.family === options.family,
          )
      if (selected === undefined) {
        callback(
          Object.assign(new Error(`${input.label} DNS resolution is forbidden`), {
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

export async function readBoundedProviderResponse(
  response: Response,
  maxBytes: number,
  ambiguousError: () => Error,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let chunkCount = 0
  let boundaryFailure: Error | null = null
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      chunks.push(next.value)
      chunkCount += 1
      if (next.value.byteLength === 0 || chunkCount > 1_024) {
        boundaryFailure = ambiguousError()
        throw boundaryFailure
      }
      total += next.value.byteLength
      if (total > maxBytes) {
        boundaryFailure = ambiguousError()
        throw boundaryFailure
      }
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
    if (error === boundaryFailure) throw error
    throw ambiguousError()
  } finally {
    for (const chunk of chunks) chunk.fill(0)
    reader.releaseLock()
  }
}

function providerRequestBodyBytes(
  body: BodyInit | null | undefined,
  invalidError: () => Error,
): Buffer {
  if (typeof body === 'string') return Buffer.from(body, 'utf8')
  if (body instanceof Uint8Array) return Buffer.from(body)
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body))
  throw invalidError()
}

export function providerUsageOfDecodedBody<Invocation, Usage>(
  bytes: Uint8Array | null,
  invocation: Invocation,
  parseUsage: (value: unknown, invocation: Invocation) => Usage | null,
): Usage | null {
  if (bytes === null) return null
  let body: unknown
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null) return null
  return parseUsage((body as Readonly<{ usage?: unknown }>).usage, invocation)
}

function singleUndiciHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const value = headers[name]
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.join(', ')
  return null
}

export function createProviderForwardFetch(
  input: Readonly<{
    logicalUrl: string
    destinationUrl: string
    dispatcher?: Dispatcher
    assertHeaders?(headers: Headers): void
    invalidError: () => Error
    invalidBodyError?: () => Error
  }>,
): typeof fetch {
  return (async (requestInfo: string | URL | Request, init?: RequestInit) => {
    const { url, method } = providerFetchRequestFacts(requestInfo, init)
    if (
      url.href !== input.logicalUrl ||
      method !== 'POST' ||
      init?.redirect !== 'manual'
    ) {
      throw input.invalidError()
    }
    const headers = new Headers(
      init?.headers ?? (requestInfo instanceof Request ? requestInfo.headers : undefined),
    )
    input.assertHeaders?.(headers)
    const bodyBytes = providerRequestBodyBytes(
      init?.body ?? (requestInfo instanceof Request ? requestInfo.body : null),
      input.invalidBodyError ?? input.invalidError,
    )
    let response: Awaited<ReturnType<typeof undiciRequest>>
    try {
      response = await undiciRequest(input.destinationUrl, {
        method: 'POST',
        headers: Object.fromEntries(headers.entries()),
        body: bodyBytes,
        signal: init?.signal ?? undefined,
        ...(input.dispatcher === undefined ? {} : { dispatcher: input.dispatcher }),
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
          if (next.done) controller.close()
          else controller.enqueue(next.value)
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

export function createPinnedProviderRequestFetch(
  input: Readonly<{
    url: string
    dispatcher: Dispatcher
    invalidError: () => Error
  }>,
): typeof fetch {
  return createProviderForwardFetch({
    logicalUrl: input.url,
    destinationUrl: input.url,
    dispatcher: input.dispatcher,
    invalidError: input.invalidError,
  })
}

export function createPinnedProviderOutbound(
  input: Readonly<{
    url: string
    hostname: string
    label: string
    invalidError: () => Error
  }>,
): PinnedProviderOutbound {
  const restrictedLookup = createRestrictedProviderLookup(input)
  const dispatcher = new Agent({
    ...PINNED_PROVIDER_DISPATCHER_LIMITS,
    connect: {
      servername: input.hostname,
      minVersion: 'TLSv1.2',
      maxCachedSessions: 0,
      autoSelectFamily: false,
      lookup: restrictedLookup as never,
    },
  })
  let closePromise: Promise<void> | null = null
  return Object.freeze({
    fetch: createPinnedProviderRequestFetch({
      url: input.url,
      dispatcher,
      invalidError: input.invalidError,
    }),
    close: () => {
      closePromise ??= dispatcher.close()
      return closePromise
    },
    destroy: () => dispatcher.destroy(),
  })
}

export class GrantNonceRegistry {
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

export function evaluateProviderDispatchGate(
  input: Readonly<{
    invocation: ProviderBoundaryInvocation
    grant: AiExecutionGrantV1
    requestBindingKeys: VersionedHmacKeyring
    admissionPublicKeys: ReadonlyMap<string, KeyObject>
    nonceRegistry: GrantNonceRegistry
    currentTime: number
  }>,
): Readonly<{ accepted: boolean; reasons: readonly string[] }> {
  const attestationCurrent = providerInvocationAttestationIsCurrent(
    input.invocation,
    input.grant,
    input.requestBindingKeys,
    input.admissionPublicKeys,
  )
  const timingReasons: string[] = []
  if (
    input.grant.expiresAtEpochMillis !==
    input.invocation.descriptor.callerDeadlineEpochMillis
  )
    timingReasons.push('grant_expiry_not_caller_deadline')
  if (input.grant.issuedAtEpochMillis >= input.grant.expiresAtEpochMillis)
    timingReasons.push('grant_issued_after_expiry')
  if (input.grant.issuedAtEpochMillis > input.currentTime)
    timingReasons.push('grant_issued_in_future')
  if (input.grant.expiresAtEpochMillis <= input.currentTime)
    timingReasons.push('grant_expired')
  const nonceAccepted =
    attestationCurrent &&
    timingReasons.length === 0 &&
    input.nonceRegistry.consume(
      input.grant.nonce,
      input.grant.expiresAtEpochMillis,
      input.currentTime,
    )
  const reasons = [
    ...(attestationCurrent
      ? []
      : describeProviderAttestationFailure(
          input.invocation,
          input.grant,
          input.requestBindingKeys,
          input.admissionPublicKeys,
        )),
    ...timingReasons,
    ...(attestationCurrent && timingReasons.length === 0 && !nonceAccepted
      ? ['nonce_replayed']
      : []),
  ]
  return Object.freeze({
    accepted: attestationCurrent && timingReasons.length === 0 && nonceAccepted,
    reasons: Object.freeze(reasons),
  })
}

function invocationDigestFacts(invocation: ProviderBoundaryInvocation): Readonly<{
  digest: string
  exactOutboundBytes: boolean
}> {
  const canonical = Buffer.from(canonicalizeRfc8785(invocation.sdkRequest), 'utf8')
  const outboundBytes = Buffer.from(invocation.canonicalProviderBytes)
  try {
    return Object.freeze({
      digest: createHash('sha256')
        .update(PREPARED_DOMAIN, 'utf8')
        .update(canonical)
        .digest('hex'),
      exactOutboundBytes:
        canonical.byteLength === outboundBytes.byteLength &&
        timingSafeEqual(canonical, outboundBytes),
    })
  } finally {
    canonical.fill(0)
    outboundBytes.fill(0)
  }
}

function providerInvocationAttestationIsCurrent(
  invocation: ProviderBoundaryInvocation,
  grant: AiExecutionGrantV1,
  requestBindingKeys: VersionedHmacKeyring,
  admissionPublicKeys: ReadonlyMap<string, KeyObject>,
): boolean {
  const parsedGrant = parseAiExecutionGrant(grant)
  const facts = invocationDigestFacts(invocation)
  return (
    verifyAiExecutionGrant(parsedGrant, admissionPublicKeys) &&
    facts.exactOutboundBytes &&
    invocation.descriptor.preparedByteCount ===
      invocation.canonicalProviderBytes.byteLength &&
    invocation.descriptor.preparedDigest === facts.digest &&
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

// `providerInvocationAttestationIsCurrent` folds twelve independent checks into one
// boolean, and the caller turns a false into a silent `no_dispatch` — no log, no
// code, no provider call. From the outside that is indistinguishable from a
// deadline abort or a dead outbound boundary, which cost a full debugging cycle on
// the closed beta. This names the failing check. It runs ONLY on the failure path,
// so the happy path is untouched, and it emits identifiers and booleans only —
// never key material, never provider bytes.
function describeProviderAttestationFailure(
  invocation: ProviderBoundaryInvocation,
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
  const facts = invocationDigestFacts(invocation)
  if (!verifyAiExecutionGrant(parsedGrant, admissionPublicKeys))
    reasons.push('grant_signature_unverified')
  if (!facts.exactOutboundBytes) reasons.push('outbound_bytes_differ')
  if (
    invocation.descriptor.preparedByteCount !==
    invocation.canonicalProviderBytes.byteLength
  )
    reasons.push('prepared_byte_count_mismatch')
  if (invocation.descriptor.preparedDigest !== facts.digest)
    reasons.push('prepared_digest_mismatch')
  if (parsedGrant.subjectKind !== invocation.descriptor.subjectKind)
    reasons.push('subject_kind_mismatch')
  if (parsedGrant.route !== invocation.descriptor.route) reasons.push('route_mismatch')
  if (parsedGrant.operationId !== invocation.descriptor.operationId)
    reasons.push('operation_id_mismatch')
  if (parsedGrant.permitId !== invocation.descriptor.permitId)
    reasons.push('permit_id_mismatch')
  if (parsedGrant.attemptNumber !== invocation.descriptor.attemptNumber)
    reasons.push('attempt_mismatch')
  if (
    !verifyAiRequestBinding(
      {
        descriptor: invocation.descriptor,
        requestBindingKeyId: invocation.requestBindingKeyId,
        requestBindingHmac: invocation.requestBindingHmac,
      },
      requestBindingKeys,
    )
  )
    reasons.push('request_binding_unverified')
  if (parsedGrant.requestBindingKeyId !== invocation.requestBindingKeyId)
    reasons.push('request_binding_key_id_mismatch')
  if (parsedGrant.requestBindingHmac !== invocation.requestBindingHmac)
    reasons.push('request_binding_hmac_mismatch')
  if (
    canonicalizeRfc8785(parsedGrant.limits) !==
    canonicalizeRfc8785(invocation.descriptor.limits)
  )
    reasons.push('limits_mismatch')
  if (
    parsedGrant.callerDeadlineEpochMillis !==
    invocation.descriptor.callerDeadlineEpochMillis
  )
    reasons.push('caller_deadline_mismatch')
  return Object.freeze(
    reasons.length === 0 ? ['attestation_current_on_recheck'] : reasons,
  )
}

export async function closePinnedProviderOutbound(
  outbound: PinnedProviderOutbound,
  label: string,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      outbound.close(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} dispatcher close timed out`)),
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
