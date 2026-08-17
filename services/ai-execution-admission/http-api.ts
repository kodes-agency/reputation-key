import {
  AI_AUTHORIZE_MAX_BYTES,
  AI_INTERNAL_RESPONSE_MAX_BYTES,
  AI_SETTLE_MAX_BYTES,
  aiAdmissionRequestSchema,
  aiSettlementRequestSchema,
  readAiInternalJsonRequest,
} from '../../src/shared/ai-internal-transport-contract'
import type { AiExecutionAdmissionService } from './service'

const SAFE_IDENTITY = /^[A-Za-z0-9._:@/-]{1,255}$/

function jsonResponse(value: unknown, status = 200): Response {
  const body = JSON.stringify(value)
  if (Buffer.byteLength(body) > AI_INTERNAL_RESPONSE_MAX_BYTES) {
    return new Response('{"ok":false,"code":"admission_unavailable"}', {
      status: 503,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
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

export async function handleAiExecutionAdmissionRequest(
  input: Readonly<{
    request: Request
    peerIdentity: string | null
    expectedGatewayIdentity: string
    service: AiExecutionAdmissionService
  }>,
): Promise<Response> {
  if (!SAFE_IDENTITY.test(input.expectedGatewayIdentity)) {
    throw new Error('AI admission gateway identity is invalid')
  }
  const path = exactPath(input.request)
  if (input.request.method === 'GET' && path === '/health/ready') {
    const ready = await input.service.readiness()
    return jsonResponse({ ok: ready }, ready ? 200 : 503)
  }
  if (input.request.method !== 'POST') {
    return jsonResponse({ ok: false, code: 'method_not_allowed' }, 405)
  }
  if (input.peerIdentity !== input.expectedGatewayIdentity) {
    return jsonResponse({ ok: false, code: 'unauthorized' }, 401)
  }
  if (path !== '/v1/authorize' && path !== '/v1/settle') {
    return jsonResponse({ ok: false, code: 'not_found' }, 404)
  }

  try {
    if (path === '/v1/authorize') {
      const request = await readAiInternalJsonRequest(
        input.request,
        AI_AUTHORIZE_MAX_BYTES,
        aiAdmissionRequestSchema,
      )
      return jsonResponse(await input.service.authorize(request))
    }
    const request = await readAiInternalJsonRequest(
      input.request,
      AI_SETTLE_MAX_BYTES,
      aiSettlementRequestSchema,
    )
    return jsonResponse(await input.service.settle(request))
  } catch (error) {
    if (error instanceof Error && error.message === 'AI internal request is invalid') {
      return jsonResponse({ ok: false, code: 'malformed_request' }, 400)
    }
    return jsonResponse({ ok: false, code: 'admission_unavailable' }, 503)
  }
}
