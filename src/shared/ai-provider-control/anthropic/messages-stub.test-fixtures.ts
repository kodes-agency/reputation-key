export type ScriptedAnthropicMessage = Readonly<{
  kind: 'message'
  body: Readonly<Record<string, unknown>>
}>

export type ScriptedAnthropicError = Readonly<{
  kind: 'error'
  status: number
  type: string
  message: string
  details?: Readonly<Record<string, unknown>>
  retryAfterSeconds?: number
}>

export type ScriptedAnthropicTransportFailure = Readonly<{
  kind: 'throw'
  error: Error
}>

export type ScriptedMessagesResult =
  ScriptedAnthropicMessage | ScriptedAnthropicError | ScriptedAnthropicTransportFailure

export type ScriptedMessagesCall = Readonly<{
  url: string
  method: string
  headers: Readonly<Record<string, string>>
  bodyBytes: Uint8Array
}>

export function anthropicMessageBody(
  input: Readonly<{
    answer?: unknown
    content?: readonly Readonly<Record<string, unknown>>[]
    stopReason?: string
    stopDetails?: unknown
    usage?: unknown
  }> = {},
): Readonly<Record<string, unknown>> {
  return {
    id: 'msg_invented_01',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: input.content ?? [
      {
        type: 'text',
        text: JSON.stringify(input.answer ?? { ok: true }),
        citations: null,
      },
    ],
    stop_reason: input.stopReason ?? 'end_turn',
    stop_sequence: null,
    stop_details: input.stopDetails ?? null,
    container: null,
    diagnostics: null,
    usage: input.usage ?? {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cache_creation: null,
      output_tokens_details: { thinking_tokens: 1 },
      service_tier: 'standard',
      speed: 'standard',
      inference_geo: null,
      server_tool_use: null,
    },
  }
}

export function scriptedMessagesFetch(
  script: readonly ScriptedMessagesResult[],
): typeof fetch & Readonly<{ calls: ScriptedMessagesCall[] }> {
  const queue = [...script]
  const calls: ScriptedMessagesCall[] = []
  const fake = (async (
    requestInfo: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const next = queue.shift()
    if (next === undefined) throw new Error('Unscripted Anthropic request refused')
    const url =
      typeof requestInfo === 'string' || requestInfo instanceof URL
        ? String(requestInfo)
        : requestInfo.url
    const body = init?.body
    const bodyBytes =
      typeof body === 'string'
        ? Buffer.from(body, 'utf8')
        : body instanceof Uint8Array
          ? Buffer.from(body)
          : body instanceof ArrayBuffer
            ? Buffer.from(new Uint8Array(body))
            : Buffer.alloc(0)
    calls.push(
      Object.freeze({
        url,
        method: init?.method ?? 'GET',
        headers: Object.freeze(Object.fromEntries(new Headers(init?.headers).entries())),
        bodyBytes: Buffer.from(bodyBytes),
      }),
    )
    bodyBytes.fill(0)
    if (next.kind === 'throw') throw next.error
    if (next.kind === 'error') {
      return new Response(
        JSON.stringify({
          type: 'error',
          error: {
            type: next.type,
            message: next.message,
            ...(next.details === undefined ? {} : { details: next.details }),
          },
          request_id: 'req_invented_01',
        }),
        {
          status: next.status,
          headers:
            next.retryAfterSeconds === undefined
              ? { 'content-type': 'application/json' }
              : {
                  'content-type': 'application/json',
                  'retry-after': String(next.retryAfterSeconds),
                },
        },
      )
    }
    return new Response(JSON.stringify(next.body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch & Readonly<{ calls: ScriptedMessagesCall[] }>
  Object.defineProperty(fake, 'calls', { value: calls })
  return fake
}
