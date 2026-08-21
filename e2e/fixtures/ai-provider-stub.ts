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
    case 'review_analysis_v1':
      return 'analysis'
    case 'reply_template_selection_v1':
      return 'reply'
    case 'property_trend_v1':
      return 'trend'
    case 'synthetic_canary_v1':
      return 'synthetic_canary'
    default:
      return null
  }
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
    if (request.method !== 'POST' || url.pathname !== '/v1/responses') {
      json(response, 404, { error: 'not_found' })
      return
    }
    const operationKind = parseOperationKind(body)
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
    const script = scripts.get(operationKind)?.shift()
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
    json(response, status, status === 200 ? providerResponse(script) : {}, headers)
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
