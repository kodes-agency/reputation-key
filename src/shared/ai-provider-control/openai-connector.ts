import { type KeyObject } from 'node:crypto'
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import type { Dispatcher } from 'undici'
import { z } from 'zod/v4'
import {
  explainJsonBytesRejection,
  type AiExecutionGrantV1,
} from '#/shared/ai-internal-transport-contract'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import {
  OPENAI_RESPONSES_URL,
  OPENAI_USER_AGENT,
  type OpenAiConnector,
  type OpenAiConnectorOutcome,
  type PreparedAiInvocation,
} from './contracts'
import {
  classifyOpenAiRefusal,
  parseOpenAiJsonContentType,
  parseOpenAiRetryAfter,
} from './dispositions'
import { deriveOpenAiClientRequestId } from './prepared-invocation'
import { parseUsage, usageOfDecodedBody } from './openai-usage'
import {
  GrantNonceRegistry,
  PINNED_PROVIDER_DISPATCHER_LIMITS,
  PROVIDER_ZERO_USAGE as ZERO_USAGE,
  closePinnedProviderOutbound,
  createOneShotProviderFetch,
  createPinnedProviderOutbound,
  createPinnedProviderRequestFetch,
  createRestrictedProviderLookup,
  isForbiddenProviderAddress,
  providerConnectorOutcome as connectorOutcome,
  type OneShotProviderFetchState,
  type PinnedProviderOutbound,
  type ProviderDnsLookupAll,
} from './connector-boundary'
import {
  outcomeOfProviderThrow,
  refusalAtProviderDispatchGate,
} from './connector-outcomes'

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

export type OneShotOpenAiFetchState = OneShotProviderFetchState

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
    'user-agent': 'OpenAI/JS 7.43.0',
    'x-stainless-arch': process.arch,
    'x-stainless-lang': 'js',
    'x-stainless-os': os,
    'x-stainless-package-version': '7.43.0',
    'x-stainless-retry-count': '0',
    'x-stainless-runtime': 'node',
    'x-stainless-runtime-version': process.version,
  })
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
  return createOneShotProviderFetch({
    apiKey: input.apiKey,
    url: OPENAI_RESPONSES_URL,
    canonicalProviderBytes: input.canonicalProviderBytes,
    responseBytes: input.responseBytes,
    outboundFetch: input.outboundFetch,
    signal: input.signal,
    expectedSdkHeaders: expectedPinnedSdkHeaders,
    outboundHeaders: () =>
      new Headers({
        authorization: `Bearer ${input.apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': OPENAI_USER_AGENT,
        'x-client-request-id': deriveOpenAiClientRequestId(input.permitId),
      }),
    invalidError: () => new InvalidOpenAiRequestError(),
    ambiguousError: () => new AmbiguousOpenAiTransportError(),
    invalidOutputError: (reason) => new InvalidOpenAiOutputError(reason),
    parseRetryAfter: parseOpenAiRetryAfter,
    validJsonContentType: parseOpenAiJsonContentType,
    onSecondInvocation: (requestInfo, init) => {
      if (input.route !== 'synthetic-canary') return
      const rawUrl =
        typeof requestInfo === 'string' || requestInfo instanceof URL
          ? String(requestInfo)
          : requestInfo.url
      let path = 'unparseable'
      try {
        path = new URL(rawUrl).pathname
      } catch {
        // The diagnostic stays content-free for an unparseable SDK URL.
      }
      process.stderr.write(
        `${JSON.stringify({
          event: 'canary_second_call_rejected',
          method:
            init?.method ?? (requestInfo instanceof Request ? requestInfo.method : 'GET'),
          path,
        })}\n`,
      )
    },
    onInvalidJson: (bytes, response) => {
      if (input.route !== 'synthetic-canary') return
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
    },
  })
}

export function isForbiddenOpenAiAddress(address: string): boolean {
  return isForbiddenProviderAddress(address)
}

type OpenAiDnsLookupAll = ProviderDnsLookupAll

export function createRestrictedOpenAiLookup(lookupAll?: OpenAiDnsLookupAll) {
  return createRestrictedProviderLookup({
    hostname: 'api.openai.com',
    label: 'OpenAI',
    ...(lookupAll === undefined ? {} : { lookupAll }),
  })
}

type PinnedOpenAiOutbound = PinnedProviderOutbound

/**
 * Fetch-compatible adapter for the one network primitive used by the OpenAI
 * connector. The destination remains compiled even when tests inject a
 * dispatcher that captures the actual HTTP/1.1 bytes.
 */
export function createPinnedOpenAiRequestFetch(dispatcher: Dispatcher): typeof fetch {
  return createPinnedProviderRequestFetch({
    url: OPENAI_RESPONSES_URL,
    dispatcher,
    invalidError: () => new InvalidOpenAiRequestError(),
  })
}

export const PINNED_OPENAI_DISPATCHER_LIMITS = PINNED_PROVIDER_DISPATCHER_LIMITS

function createPinnedOpenAiOutboundFetch(): PinnedOpenAiOutbound {
  return createPinnedProviderOutbound({
    url: OPENAI_RESPONSES_URL,
    hostname: 'api.openai.com',
    label: 'OpenAI',
    invalidError: () => new InvalidOpenAiRequestError(),
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

type OpenAiParsedResponseFacts = Readonly<{
  usage?: unknown
  status?: string
  incomplete_details?: Readonly<{ reason?: string }> | null
  output_parsed?: unknown
}>

/**
 * What a 200 the SDK parsed came to: billed usage, a refusal, a truncation or an
 * answer. Usage is judged first, so an answer that is unusable for any reason is
 * still priced as it was billed.
 */
function outcomeOfOpenAiResponse(
  response: OpenAiParsedResponseFacts,
  invocation: PreparedAiInvocation,
  outputSchema: z.ZodTypeAny,
): OpenAiConnectorOutcome<unknown> {
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
}

// The synthetic canary route alone says why an answer was unusable; no tenant route
// writes anything about it.
function canaryThrowDiagnostics(
  route: string,
): Pick<
  Parameters<typeof outcomeOfProviderThrow>[0],
  'onInvalidOutput' | 'onPost200Throw'
> {
  if (route !== 'synthetic-canary') return {}
  return {
    onInvalidOutput: (error) => {
      process.stderr.write(
        `${JSON.stringify({
          event: 'canary_output_invalid',
          reason:
            error instanceof InvalidOpenAiOutputError ? error.reason : 'unspecified',
        })}\n`,
      )
    },
    onPost200Throw: (error) => {
      process.stderr.write(
        `${JSON.stringify({ event: 'canary_output_invalid', reason: 'post_200_throw', error: describeCanaryThrow(error) })}\n`,
      )
    },
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
      const gateRefusal = refusalAtProviderDispatchGate({
        invocation,
        grant,
        requestBindingKeys: dependencies.requestBindingKeys,
        admissionPublicKeys: dependencies.admissionPublicKeys,
        nonceRegistry,
        now,
      })
      if (gateRefusal !== null) return gateRefusal
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
        return outcomeOfOpenAiResponse(response, invocation, outputSchema)
      } catch (error) {
        return outcomeOfProviderThrow({
          error,
          state: boundary?.state ?? null,
          pinnedAbsent: pinned === null,
          invocation,
          responseBytes: grant.limits.responseBytes,
          signal,
          classifyRefusal: classifyOpenAiRefusal,
          isInvalidOutput: (value) => value instanceof InvalidOpenAiOutputError,
          usageOfDecodedBody: (bytes) => usageOfDecodedBody(bytes, invocation),
          ...canaryThrowDiagnostics(invocation.descriptor.route),
        })
      } finally {
        boundary?.dispose()
        invocation.canonicalProviderBytes.fill(0)
        if (pinned !== null && !(await closePinnedProviderOutbound(pinned, 'OpenAI')))
          cleanupHealthy = false
      }
    },
    readiness: () => cleanupHealthy,
  })
}
