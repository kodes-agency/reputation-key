import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { createServer as createHttpsServer } from 'node:https'

export const AI_PROVIDER_STUB_PORT = 4102
export type AiProviderStubOperationKind =
  'analysis' | 'reply' | 'trend' | 'synthetic_canary'

type TokenUsage = Readonly<{
  inputTokens: number
  cachedTokens: number
  outputTokens: number
  reasoningTokens: number
}>
export type AiProviderStubResponse = Readonly<{
  operationKind: AiProviderStubOperationKind
  status?: number
  parsed?: unknown
  refusal?: string
  retryAfterSeconds?: number
  delayMillis?: number
  usage?: TokenUsage
}>
export type AiProviderStubCall = Readonly<{
  ordinal: number
  operationKind: AiProviderStubOperationKind
  outcome: 'response' | 'unscripted' | 'invalid_request'
  status: number
}>
export type AiProviderStubHandle = Readonly<{
  host: string
  port: number
  baseUrl: string
  stop(): Promise<void>
}>

type TlsOptions = Readonly<{ cert: Buffer; key: Buffer }>
const MAX_BODY_BYTES = 131_072
const scripts = new Map<AiProviderStubOperationKind, AiProviderStubResponse[]>()
const calls: AiProviderStubCall[] = []
let callOrdinal = 0

function json(
  response: ServerResponse,
  status: number,
  value: unknown,
  headers = {},
): void {
  response.writeHead(status, { 'content-type': 'application/json', ...headers })
  response.end(JSON.stringify(value))
}

async function readBody(request: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = []
  let length = 0
  try {
    for await (const value of request) {
      const chunk = Buffer.from(value as Uint8Array)
      length += chunk.byteLength
      if (length > MAX_BODY_BYTES) {
        chunk.fill(0)
        return null
      }
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  } finally {
    for (const chunk of chunks) chunk.fill(0)
  }
}

function exactObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  return (
    actual.length === keys.length &&
    actual.every((key, index) => key === [...keys].sort()[index])
  )
}

function parseOperationKind(body: unknown): AiProviderStubOperationKind | null {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null
  const text = (body as Record<string, unknown>).text
  if (text === null || typeof text !== 'object' || Array.isArray(text)) return null
  const format = (text as Record<string, unknown>).format
  if (format === null || typeof format !== 'object' || Array.isArray(format)) return null
  switch ((format as Record<string, unknown>).name) {
    case 'review_analysis_v3':
    case 'review_analysis_v2':
      return 'analysis'
    case 'reply_draft_v4':
    case 'reply_draft_v1':
      return 'reply'
    case 'property_trend_v1':
      return 'trend'
    case 'synthetic_canary_v1':
      return 'synthetic_canary'
    default:
      return null
  }
}

const ANTHROPIC_REQUEST_KEYS = Object.freeze([
  'max_tokens',
  'messages',
  'metadata',
  'model',
  'output_config',
  'system',
  'thinking',
])

function hasAnthropicHeaders(request: IncomingMessage): boolean {
  return (
    request.headers.accept === 'application/json' &&
    request.headers['anthropic-version'] === '2026-10-21' &&
    request.headers['content-type'] === 'application/json' &&
    request.headers['user-agent'] === 'repkey-ai-egress-gateway/1.0' &&
    typeof request.headers['x-api-key'] === 'string' &&
    request.headers['x-api-key'].length > 0
  )
}

function parseAnthropicOperationKind(body: unknown): AiProviderStubOperationKind | null {
  if (!exactObject(body, ANTHROPIC_REQUEST_KEYS)) return null
  const outputConfig = body.output_config
  if (outputConfig === null || typeof outputConfig !== 'object') return null
  const format = (outputConfig as Record<string, unknown>).format
  if (format === null || typeof format !== 'object') return null
  const schema = (format as Record<string, unknown>).schema
  if (schema === null || typeof schema !== 'object') return null
  const properties = (schema as Record<string, unknown>).properties
  if (properties === null || typeof properties !== 'object') return null
  return ['sentiment', 'mentions', 'urgent'].every((key) =>
    Object.hasOwn(properties, key),
  )
    ? 'analysis'
    : null
}

function parseScript(value: unknown): AiProviderStubResponse | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const allowed = [
    'operationKind',
    'status',
    'parsed',
    'refusal',
    'retryAfterSeconds',
    'delayMillis',
    'usage',
  ] as const
  if (
    Object.keys(candidate).some(
      (key) => !allowed.includes(key as (typeof allowed)[number]),
    )
  )
    return null
  if (
    !['analysis', 'reply', 'trend', 'synthetic_canary'].includes(
      String(candidate.operationKind),
    )
  )
    return null
  if (
    candidate.status !== undefined &&
    (!Number.isInteger(candidate.status) ||
      Number(candidate.status) < 100 ||
      Number(candidate.status) > 599)
  )
    return null
  if (candidate.refusal !== undefined && typeof candidate.refusal !== 'string')
    return null
  if (candidate.refusal !== undefined && candidate.parsed !== undefined) return null
  for (const key of ['retryAfterSeconds', 'delayMillis'] as const) {
    const number = candidate[key]
    if (number !== undefined && (!Number.isSafeInteger(number) || Number(number) < 0))
      return null
  }
  if (candidate.usage !== undefined) {
    if (
      !exactObject(candidate.usage, [
        'inputTokens',
        'cachedTokens',
        'outputTokens',
        'reasoningTokens',
      ])
    )
      return null
    const usage = candidate.usage as Record<string, unknown>
    if (
      Object.values(usage).some(
        (number) => !Number.isSafeInteger(number) || Number(number) < 0,
      )
    )
      return null
    if (
      Number(usage.cachedTokens) > Number(usage.inputTokens) ||
      Number(usage.reasoningTokens) > Number(usage.outputTokens)
    )
      return null
  }
  return candidate as AiProviderStubResponse
}

function providerResponse(script: AiProviderStubResponse): Record<string, unknown> {
  const usage = script.usage ?? {
    inputTokens: 10,
    cachedTokens: 2,
    outputTokens: 5,
    reasoningTokens: 1,
  }
  const content =
    script.refusal === undefined
      ? [
          {
            type: 'output_text',
            text: JSON.stringify(script.parsed ?? {}),
            annotations: [],
            logprobs: [],
          },
        ]
      : [{ type: 'refusal', refusal: script.refusal }]
  return {
    id: 'synthetic-provider-response-id',
    object: 'response',
    created_at: 1_780_000_000,
    status: 'completed',
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: 8192,
    model: 'gpt-5.4-mini-2026-03-17',
    output: [
      {
        id: 'synthetic-message-id',
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
      total_tokens: usage.inputTokens + usage.outputTokens,
    },
  }
}

function anthropicProviderResponse(
  script: AiProviderStubResponse,
): Record<string, unknown> {
  const usage = script.usage ?? {
    inputTokens: 10,
    cachedTokens: 2,
    outputTokens: 5,
    reasoningTokens: 1,
  }
  const refusal = script.refusal
  return {
    id: 'synthetic-anthropic-message-id',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [
      {
        type: 'text',
        text: JSON.stringify(refusal === undefined ? (script.parsed ?? {}) : {}),
      },
    ],
    stop_reason: refusal === undefined ? 'end_turn' : 'refusal',
    stop_sequence: null,
    stop_details:
      refusal === undefined
        ? null
        : { type: 'refusal', category: 'general_harms', explanation: refusal },
    usage: {
      input_tokens: usage.inputTokens - usage.cachedTokens,
      output_tokens: usage.outputTokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: usage.cachedTokens,
      cache_creation: null,
      output_tokens_details: { thinking_tokens: usage.reasoningTokens },
      service_tier: 'standard',
      speed: 'standard',
      inference_geo: 'global',
      server_tool_use: null,
    },
  }
}

function anthropicError(status: number): Record<string, unknown> {
  const type =
    status === 402
      ? 'billing_error'
      : status === 429
        ? 'rate_limit_error'
        : status === 529
          ? 'overloaded_error'
          : 'api_error'
  return {
    type: 'error',
    error: { type, message: `Synthetic ${type}` },
    request_id: 'synthetic-anthropic-request-id',
  }
}

/**
 * `AI_PROVIDER_STUB_UNSCRIPTED=respond` (the local inner loop, `pnpm local:up`):
 * an unscripted request gets a synthesized answer instead of 503, so analysis,
 * drafting and trends run end to end without arming the stub first. The
 * answers are derived from the request's own provider payload (`input[1]`,
 * the canonical JSON the route preparer built) because the app's acceptance
 * rules are content-bound: a reply must quote the review and name the
 * property exactly once. The e2e stack keeps the default, `503`, so specs
 * stay deterministic.
 */
type UnscriptedMode = '503' | 'respond'

function unscriptedMode(): UnscriptedMode {
  return process.env.AI_PROVIDER_STUB_UNSCRIPTED === 'respond' ? 'respond' : '503'
}

function providerPayload(body: Record<string, unknown>): Record<string, unknown> | null {
  const input = body.input
  if (!Array.isArray(input) || input.length < 2) return null
  const second = input[1] as { content?: unknown } | null
  if (
    second === null ||
    typeof second !== 'object' ||
    typeof second.content !== 'string'
  ) {
    return null
  }
  try {
    const parsed = JSON.parse(second.content) as unknown
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function anthropicProviderPayload(
  body: Record<string, unknown>,
): Record<string, unknown> | null {
  const messages = body.messages
  if (!Array.isArray(messages) || messages.length !== 1) return null
  const first = messages[0] as { role?: unknown; content?: unknown } | undefined
  if (first?.role !== 'user' || typeof first.content !== 'string') return null
  try {
    const parsed = JSON.parse(first.content) as unknown
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function synthesizedAnthropicAnalysis(
  payload: Record<string, unknown> | null,
): Record<string, unknown> {
  const rating = typeof payload?.rating === 'number' ? payload.rating : 5
  return {
    sentiment: rating >= 4 ? 'positive' : rating === 3 ? 'neutral' : 'negative',
    mentions: [],
    urgent: null,
  }
}

function synthesizedReply(
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const reviewText =
    typeof payload.reviewText === 'string' ? payload.reviewText.trim() : ''
  const propertyDisplayName =
    typeof payload.propertyDisplayName === 'string' ? payload.propertyDisplayName : ''
  const languageCode =
    typeof payload.languageCode === 'string' ? payload.languageCode : 'en-Latn'
  if (reviewText.length < 2 || propertyDisplayName.length === 0) return null
  // The excerpt must appear verbatim in both texts, must not carry the
  // property name (the reply may contain it exactly once), and must survive
  // the app's leakage scanner - so it is the longest run of plain words, never
  // a fragment with digits, codes or punctuation that reads as an identifier.
  const excerpt = reviewText
    .split(/[^\p{L}\s'’-]+/u)
    .map((fragment) => fragment.trim().replace(/\s+/gu, ' '))
    .filter((fragment) => fragment.length >= 2 && !fragment.includes(propertyDisplayName))
    .sort((a, b) => b.length - a.length)[0]
    ?.slice(0, 80)
    .trim()
  if (excerpt === undefined || excerpt.length < 2) return null
  const replyText = `Thank you for telling us about ${excerpt}. Everyone at ${propertyDisplayName} appreciates you taking the time, and we hope to welcome you again soon.`
  return {
    languageCode,
    replyText,
    grounding: [{ sourceExcerpt: excerpt, replyExcerpt: excerpt }],
  }
}

/** V2 drafts only a body; the application's real voice supplies its frame. */
function synthesizedReplyV2(payload: Record<string, unknown>): Record<string, unknown> {
  const languageCode =
    typeof payload.languageCode === 'string' ? payload.languageCode : 'en-Latn'
  const rating = typeof payload.rating === 'number' ? payload.rating : 5
  const replies: Record<string, string> = {
    'en-Latn': 'We appreciate you sharing this experience with us.',
    'es-Latn': 'Agradecemos que haya compartido su experiencia con nosotros.',
    'bg-Cyrl': 'Благодарим ви, че споделихте преживяването си с нас.',
  }
  return {
    languageCode,
    case: rating >= 4 ? 'praise' : 'complaint',
    mainPoint: [1],
    avoidTerms: [],
    replyText: replies[languageCode] ?? replies['en-Latn'],
  }
}

function providerStreamResponse(
  response: ServerResponse,
  script: AiProviderStubResponse,
): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
  })
  const text = JSON.stringify(script.parsed ?? {})
  const split = Math.max(1, text.indexOf('"replyText"'))
  for (const delta of [text.slice(0, split), text.slice(split)]) {
    response.write(
      `data: ${JSON.stringify({ type: 'response.output_text.delta', delta })}\n\n`,
    )
  }
  response.end(
    `data: ${JSON.stringify({ type: 'response.completed', response: providerResponse(script) })}\n\ndata: [DONE]\n\n`,
  )
}

function synthesizedParsed(
  operationKind: AiProviderStubOperationKind,
  payload: Record<string, unknown> | null,
): Record<string, unknown> | null {
  switch (operationKind) {
    case 'analysis': {
      const rating = typeof payload?.rating === 'number' ? payload.rating : 5
      return rating >= 4
        ? {
            sentiment: 'positive',
            sentimentValence: 60,
            urgencySignals: [],
            aspects: [{ aspect: 'service', polarity: 'positive', intensity: 60 }],
            issueLabel: null,
          }
        : rating === 3
          ? {
              sentiment: 'neutral',
              sentimentValence: 0,
              urgencySignals: [],
              aspects: [{ aspect: 'service', polarity: 'neutral', intensity: 0 }],
              issueLabel: null,
            }
          : {
              sentiment: 'negative',
              sentimentValence: -60,
              urgencySignals: [],
              aspects: [{ aspect: 'service', polarity: 'negative', intensity: -60 }],
              issueLabel: 'service recovery',
            }
    }
    case 'reply':
      return payload === null
        ? null
        : payload.replyProfileVersion === 'reply-draft-v4'
          ? synthesizedReplyV2(payload)
          : synthesizedReply(payload)
    case 'trend':
      return { selectedSignalIds: ['sentiment.positive.up'] }
    case 'synthetic_canary':
      return { marker: 'synthetic_canary_ok' }
  }
}

async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://stub.invalid')
  if (request.method === 'GET' && url.pathname === '/__control/health') {
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('ok')
    return
  }
  if (request.method === 'GET' && url.pathname === '/__control/calls') {
    const kind = url.searchParams.get('operationKind')
    json(
      response,
      200,
      kind === null ? calls : calls.filter((call) => call.operationKind === kind),
    )
    return
  }
  if (request.method === 'GET') {
    json(response, 405, { error: 'method_not_allowed' })
    return
  }
  const bodyBytes = await readBody(request)
  if (bodyBytes === null) {
    json(response, 413, { error: 'body_too_large' })
    return
  }
  try {
    const body = JSON.parse(bodyBytes.toString('utf8')) as unknown
    if (request.method === 'POST' && url.pathname === '/__control/arm') {
      const script = parseScript(body)
      if (script === null) {
        json(response, 400, { error: 'invalid_script' })
        return
      }
      const queue = scripts.get(script.operationKind) ?? []
      queue.push(script)
      scripts.set(script.operationKind, queue)
      json(response, 201, { armed: true, queueDepth: queue.length })
      return
    }
    if (request.method === 'POST' && url.pathname === '/__control/reset') {
      scripts.clear()
      calls.length = 0
      callOrdinal = 0
      json(response, 200, { reset: true })
      return
    }
    const isAnthropic = url.pathname === '/v1/messages'
    if (request.method !== 'POST' || (url.pathname !== '/v1/responses' && !isAnthropic)) {
      json(response, 404, { error: 'not_found' })
      return
    }
    const operationKind = isAnthropic
      ? hasAnthropicHeaders(request)
        ? parseAnthropicOperationKind(body)
        : null
      : parseOperationKind(body)
    if (operationKind === null) {
      calls.push({
        ordinal: ++callOrdinal,
        operationKind: 'analysis',
        outcome: 'invalid_request',
        status: 400,
      })
      json(response, 400, { error: 'invalid_request' })
      return
    }
    let script = scripts.get(operationKind)?.shift()
    if (script === undefined && unscriptedMode() === 'respond') {
      const parsed = isAnthropic
        ? synthesizedAnthropicAnalysis(
            anthropicProviderPayload(body as Record<string, unknown>),
          )
        : synthesizedParsed(
            operationKind,
            providerPayload(body as Record<string, unknown>),
          )
      if (parsed !== null) script = { operationKind, parsed }
    }
    if (script === undefined) {
      calls.push({
        ordinal: ++callOrdinal,
        operationKind,
        outcome: 'unscripted',
        status: 503,
      })
      json(response, 503, { error: 'unscripted' })
      return
    }
    if ((script.delayMillis ?? 0) > 0) {
      const delayed = Promise.withResolvers<void>()
      setTimeout(delayed.resolve, script.delayMillis)
      await delayed.promise
    }
    const status = script.status ?? 200
    calls.push({ ordinal: ++callOrdinal, operationKind, outcome: 'response', status })
    const headers =
      script.retryAfterSeconds === undefined
        ? {}
        : { 'retry-after': String(script.retryAfterSeconds) }
    const value = isAnthropic
      ? status === 200
        ? anthropicProviderResponse(script)
        : anthropicError(status)
      : status === 200
        ? providerResponse(script)
        : {}
    if (
      !isAnthropic &&
      status === 200 &&
      (body as Record<string, unknown>).stream === true
    ) {
      providerStreamResponse(response, script)
      return
    }
    json(response, status, value, headers)
  } catch {
    json(response, 400, { error: 'invalid_json' })
  } finally {
    bodyBytes.fill(0)
  }
}

export async function startAiProviderStub(
  port = AI_PROVIDER_STUB_PORT,
  host = '127.0.0.1',
  tls?: TlsOptions,
): Promise<AiProviderStubHandle> {
  scripts.clear()
  calls.length = 0
  callOrdinal = 0
  const server =
    tls === undefined
      ? createHttpServer((request, response) => void handler(request, response))
      : createHttpsServer(tls, (request, response) => void handler(request, response))
  const listening = Promise.withResolvers<void>()
  server.once('error', listening.reject)
  server.listen(port, host, listening.resolve)
  await listening.promise
  const address = server.address()
  if (address === null || typeof address === 'string')
    throw new Error('AI provider stub address unavailable')
  return Object.freeze({
    host,
    port: address.port,
    baseUrl: `${tls === undefined ? 'http' : 'https'}://${host}:${address.port}`,
    stop: () => {
      const stopped = Promise.withResolvers<void>()
      server.close((error) =>
        error === undefined ? stopped.resolve() : stopped.reject(error),
      )
      return stopped.promise
    },
  })
}
