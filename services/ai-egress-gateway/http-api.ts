import {
  AI_GATEWAY_PATHS_V1,
  aiGatewayRouteRequestSchema,
  assertAiGatewayPeerRoute,
  parseAiGatewayRouteResponse,
  type AiGatewayRouteRequestV1,
} from '../../src/shared/ai-gateway-transport-contract'
import {
  AI_INTERNAL_RESPONSE_MAX_BYTES,
  AI_REVIEW_ROUTE_MAX_BYTES,
  AI_TREND_ROUTE_MAX_BYTES,
  isApplicationJsonUtf8,
} from '../../src/shared/ai-internal-transport-contract'
import { createSensitiveSourceLease } from './source-lease'
import { readGatewaySourceRequest } from './source-reader'
import type { AiEgressGatewayService } from './service'

function response(value: unknown, status = 200): Response {
  const body = JSON.stringify(value)
  if (Buffer.byteLength(body, 'utf8') > AI_INTERNAL_RESPONSE_MAX_BYTES) {
    return new Response('{"ok":false,"code":"internal_failure"}', {
      status: 503,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }
  return new Response(body, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

function exactPath(request: Request): string | null {
  const url = new URL(request.url)
  return url.search === '' && url.hash === '' ? url.pathname : null
}

function routeForPath(path: string | null): AiGatewayRouteRequestV1['route'] | null {
  if (path === null) return null
  for (const [route, gatewayPath] of Object.entries(AI_GATEWAY_PATHS_V1)) {
    if (gatewayPath === path) return route as AiGatewayRouteRequestV1['route']
  }
  return null
}

function invalidRequest(route: AiGatewayRouteRequestV1['route']): Response {
  return response(
    parseAiGatewayRouteResponse({
      route,
      status: 'error',
      code: 'invalid_request',
      retryAfterEpochMillis: null,
    }),
  )
}

export function preflightAiEgressGatewayIncomingRequest(
  input: Readonly<{
    method: string
    path: string
    headers: Readonly<Record<string, string | readonly string[] | undefined>>
    peerIdentity: string | null
  }>,
): boolean {
  if (input.peerIdentity === null || input.headers['content-encoding'] !== undefined) {
    return false
  }
  const expect = input.headers.expect
  if (Array.isArray(expect) || (expect !== undefined && expect !== '100-continue')) {
    return false
  }
  if (input.method === 'GET' && input.path === '/health/ready') {
    const contentLength = input.headers['content-length']
    return (
      expect === undefined &&
      input.headers['transfer-encoding'] === undefined &&
      (contentLength === undefined || contentLength === '0')
    )
  }
  const route = routeForPath(input.path)
  if (input.method !== 'POST' || route === null) return false
  try {
    assertAiGatewayPeerRoute(route, input.peerIdentity)
  } catch {
    return false
  }
  const contentType = input.headers['content-type']
  if (typeof contentType !== 'string' || !isApplicationJsonUtf8(contentType)) {
    return false
  }
  const contentLength = input.headers['content-length']
  if (contentLength !== undefined && typeof contentLength !== 'string') return false
  if (contentLength !== undefined) {
    if (!/^(0|[1-9][0-9]*)$/.test(contentLength)) return false
    const parsed = Number(contentLength)
    const cap =
      route === 'property-trend' ? AI_TREND_ROUTE_MAX_BYTES : AI_REVIEW_ROUTE_MAX_BYTES
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > cap) return false
  }
  return true
}

export async function handleAiEgressGatewayRequest(
  input: Readonly<{
    request: Request
    peerIdentity: string | null
    service: AiEgressGatewayService
  }>,
): Promise<Response> {
  const path = exactPath(input.request)
  if (input.request.method === 'GET' && path === '/health/ready') {
    const ready = await input.service.readiness(input.request.signal)
    return response({ ok: ready }, ready ? 200 : 503)
  }
  const route = routeForPath(path)
  if (input.request.method !== 'POST') {
    return response({ ok: false, code: 'method_not_allowed' }, 405)
  }
  if (route === null) return response({ ok: false, code: 'not_found' }, 404)
  try {
    assertAiGatewayPeerRoute(route, input.peerIdentity)
  } catch {
    return response({ ok: false, code: 'unauthorized' }, 401)
  }

  const lease = createSensitiveSourceLease<AiGatewayRouteRequestV1>()
  try {
    const requestSchema = aiGatewayRouteRequestSchema.refine(
      (request) => request.route === route,
      { message: 'gateway route does not match request path' },
    )
    await readGatewaySourceRequest(
      input.request,
      route === 'property-trend' ? AI_TREND_ROUTE_MAX_BYTES : AI_REVIEW_ROUTE_MAX_BYTES,
      requestSchema,
      lease,
    )
    return response(await input.service.execute(lease, input.request.signal))
  } catch {
    lease.dispose()
    return invalidRequest(route)
  }
}
