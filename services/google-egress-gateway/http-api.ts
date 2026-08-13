import { z } from 'zod'
import { parseGoogleProviderRouteDescriptor } from '../../src/shared/google-provider-control/route-catalogue'
import type { GoogleEgressGateway, GoogleEgressGatewayResult } from './service'

const SAFE_ID = /^[A-Za-z0-9._:@/-]{1,255}$/
const requestSchema = z
  .object({
    permitId: z.string().regex(SAFE_ID),
    descriptor: z.unknown(),
    deadlineMs: z.number().int().safe().positive(),
  })
  .strict()

async function readBoundedJson(request: Request): Promise<unknown> {
  const maxBytes = 256 * 1024
  const declared = request.headers.get('content-length')
  if (declared !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(declared) || Number(declared) > maxBytes) {
      throw new Error('gateway request body is invalid')
    }
  }
  if (!request.body) throw new Error('gateway request body is missing')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      totalBytes += next.value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel()
        throw new Error('gateway request body is invalid')
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error('gateway request body is invalid')
  }
}

function errorResponse(code: string, retryAfterMs: number, status: number): Response {
  return new Response(JSON.stringify({ ok: false, code, retryAfterMs }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

function hasJsonContentType(request: Request): boolean {
  const contentType = request.headers.get('content-type')
  return (
    contentType !== null &&
    /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType) &&
    request.headers.get('content-encoding') === null
  )
}

export async function handleGoogleEgressGatewayRequest(
  input: Readonly<{
    request: Request
    callerIdentity: string | null
    readiness?: () => Promise<boolean>
    allowedCallerIdentities: ReadonlySet<string>
    gateway: GoogleEgressGateway
  }>,
): Promise<Response> {
  const url = new URL(input.request.url)
  const exactPath = url.search === '' && url.hash === ''
  if (input.request.method === 'GET' && exactPath && url.pathname === '/health/ready') {
    const ready = input.readiness ? await input.readiness() : true
    return new Response(JSON.stringify({ ok: ready }), {
      status: ready ? 200 : 503,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  }
  if (
    !input.callerIdentity ||
    !SAFE_ID.test(input.callerIdentity) ||
    !input.allowedCallerIdentities.has(input.callerIdentity)
  ) {
    return errorResponse('unauthorized', 0, 401)
  }
  if (input.request.method !== 'POST' || !exactPath || url.pathname !== '/v1/execute') {
    const methodAllowed = input.request.method === 'POST'
    return errorResponse(
      methodAllowed ? 'not_found' : 'method_not_allowed',
      0,
      methodAllowed ? 404 : 405,
    )
  }
  if (!hasJsonContentType(input.request)) {
    return errorResponse('malformed_request', 0, 400)
  }
  let body: unknown
  try {
    body = await readBoundedJson(input.request)
  } catch {
    return errorResponse('malformed_request', 0, 400)
  }
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) return errorResponse('malformed_request', 0, 400)
  let descriptor
  try {
    descriptor = parseGoogleProviderRouteDescriptor(parsed.data.descriptor)
  } catch {
    return errorResponse('malformed_request', 0, 400)
  }
  let result: GoogleEgressGatewayResult
  try {
    result = await input.gateway.execute({
      permitId: parsed.data.permitId,
      descriptor,
      deadlineMs: parsed.data.deadlineMs,
    })
  } catch {
    return errorResponse('transport_error', 0, 503)
  }
  if (!result.ok) {
    const status =
      result.code === 'malformed_request'
        ? 400
        : result.code === 'admission_denied'
          ? 429
          : result.code === 'deadline_exceeded'
            ? 504
            : 502
    return errorResponse(result.code, result.retryAfterMs, status)
  }
  return new Response(Buffer.from(result.body), {
    status: 200,
    headers: {
      'content-type': result.headers.contentType ?? 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-repkey-provider-status': String(result.status),
      ...(result.headers.contentType
        ? { 'x-repkey-provider-content-type': result.headers.contentType }
        : {}),
      ...(result.headers.cacheControl
        ? { 'x-repkey-provider-cache-control': result.headers.cacheControl }
        : {}),
      ...(result.headers.retryAfter
        ? { 'x-repkey-provider-retry-after': result.headers.retryAfter }
        : {}),
    },
  })
}

export type GoogleEgressRawTransport = Readonly<{
  postRaw(
    path: '/v1/execute',
    body: unknown,
  ): Promise<
    Readonly<{
      status: number
      headers: Headers
      body: Uint8Array
    }>
  >
}>

const gatewayErrorSchema = z
  .object({
    ok: z.literal(false),
    code: z.enum([
      'malformed_request',
      'admission_denied',
      'admission_mismatch',
      'deadline_exceeded',
      'transport_error',
      'response_too_large',
    ]),
    retryAfterMs: z.number().int().safe().min(0).max(300_000),
  })
  .strict()

export function createGoogleEgressGatewayHttpClient(
  transport: GoogleEgressRawTransport,
): GoogleEgressGateway {
  return Object.freeze({
    execute: async (input) => {
      let response: Awaited<ReturnType<GoogleEgressRawTransport['postRaw']>>
      try {
        response = await transport.postRaw('/v1/execute', input)
      } catch {
        return { ok: false, code: 'transport_error', retryAfterMs: 0 }
      }
      if (response.status !== 200) {
        try {
          const parsed = gatewayErrorSchema.safeParse(
            JSON.parse(new TextDecoder().decode(response.body)),
          )
          return parsed.success
            ? parsed.data
            : { ok: false, code: 'transport_error', retryAfterMs: 0 }
        } catch {
          return { ok: false, code: 'transport_error', retryAfterMs: 0 }
        }
      }
      const providerStatusRaw = response.headers.get('x-repkey-provider-status')
      if (!providerStatusRaw || !/^[1-5][0-9]{2}$/.test(providerStatusRaw)) {
        return { ok: false, code: 'transport_error', retryAfterMs: 0 }
      }
      return {
        ok: true,
        status: Number(providerStatusRaw),
        headers: Object.freeze({
          contentType: response.headers.get('x-repkey-provider-content-type'),
          cacheControl: response.headers.get('x-repkey-provider-cache-control'),
          retryAfter: response.headers.get('x-repkey-provider-retry-after'),
        }),
        body: response.body,
      }
    },
  })
}
