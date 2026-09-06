import { request as undiciRequest } from 'undici'
import {
  OPENAI_RESPONSES_URL,
  OPENAI_USER_AGENT,
} from '#/shared/ai-provider-control/contracts'

const LOCAL_PROVIDER_RESPONSES_URL = 'http://ai-provider-stub:4102/v1/responses'
const CLIENT_REQUEST_ID = /^rk_ai_[A-Za-z0-9_-]{43}$/u

function bodyBytes(body: BodyInit | null | undefined): Buffer {
  if (typeof body === 'string') return Buffer.from(body, 'utf8')
  if (body instanceof Uint8Array) return Buffer.from(body)
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body))
  throw new TypeError('Local AI provider request body is invalid')
}

function assertHeaders(headers: Headers): void {
  const entries = [...headers.entries()]
  if (
    entries.length !== 5 ||
    headers.get('accept') !== 'application/json' ||
    headers.get('content-type') !== 'application/json' ||
    headers.get('user-agent') !== OPENAI_USER_AGENT ||
    !headers.get('authorization')?.startsWith('Bearer ') ||
    !CLIENT_REQUEST_ID.test(headers.get('x-client-request-id') ?? '')
  ) {
    throw new TypeError('Local AI provider request headers are invalid')
  }
}

function responseHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const value = headers[name]
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.join(', ')
  return null
}

/**
 * Local-stack transport. It accepts only the connector's compiled logical
 * OpenAI URL and forwards to one compile-time stub address.
 *
 * NO ENVIRONMENT VALUE CAN SELECT ITS DESTINATION. That invariant is why this
 * takes no origin argument. Before WP2.3 it was enforced structurally: the stub
 * path was reachable only by building a separate sidecar entrypoint, so no
 * deployed configuration could reach it. In-process there is no second
 * entrypoint, so selection had to become configuration — and the first draft of
 * that made the destination itself an env-supplied URL, which would have let one
 * leaked variable send the provider key and merchant content to an arbitrary
 * host. The destination stays compiled in; the environment can only choose
 * between this transport and the pinned real one, and `ai-egress-runtime.ts`
 * refuses even that choice in a deployed cell.
 */
export function createLocalAiProviderFetch(): typeof fetch {
  return (async (requestInfo: string | URL | Request, init?: RequestInit) => {
    const logicalUrl =
      typeof requestInfo === 'string' || requestInfo instanceof URL
        ? new URL(requestInfo)
        : new URL(requestInfo.url)
    const method =
      init?.method ?? (requestInfo instanceof Request ? requestInfo.method : 'GET')
    if (
      logicalUrl.href !== OPENAI_RESPONSES_URL ||
      method !== 'POST' ||
      init?.redirect !== 'manual'
    ) {
      throw new TypeError('Local AI provider destination is invalid')
    }
    const headers = new Headers(
      init?.headers ?? (requestInfo instanceof Request ? requestInfo.headers : undefined),
    )
    assertHeaders(headers)
    const ownedBodyBytes = bodyBytes(
      init?.body ?? (requestInfo instanceof Request ? requestInfo.body : null),
    )
    let response: Awaited<ReturnType<typeof undiciRequest>>
    try {
      response = await undiciRequest(LOCAL_PROVIDER_RESPONSES_URL, {
        method: 'POST',
        headers: Object.fromEntries(headers.entries()),
        body: ownedBodyBytes,
        signal: init?.signal ?? undefined,
      })
    } finally {
      ownedBodyBytes.fill(0)
    }
    const sanitizedHeaders = new Headers()
    for (const name of ['content-type', 'content-encoding', 'retry-after'] as const) {
      const value = responseHeader(response.headers, name)
      if (value !== null) sanitizedHeaders.set(name, value)
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
      headers: sanitizedHeaders,
    })
  }) as typeof fetch
}
