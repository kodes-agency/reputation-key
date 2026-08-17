import { describe, expect, it, vi } from 'vitest'
import type { AiExecutionAdmissionService } from './service'
import { handleAiExecutionAdmissionRequest } from './http-api'

const GATEWAY = 'spiffe://repkey.internal/ai-egress-gateway'
const operationId = '10000000-0000-4000-8000-000000000001'
const permitId = '10000000-0000-4000-8000-000000000002'

function service(): AiExecutionAdmissionService {
  return {
    authorize: vi.fn(async () => ({
      ok: false as const,
      code: 'permit_unknown' as const,
    })),
    settle: vi.fn(async () => ({ ok: false as const, code: 'permit_unknown' as const })),
    reapExpired: vi.fn(async () => 0),
    readiness: vi.fn(async () => true),
  }
}

function request(path: string, body: string, headers?: HeadersInit): Request {
  return new Request(`https://internal.invalid${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  })
}

describe('AI execution admission HTTP boundary', () => {
  it('accepts a closed settlement request only from the gateway identity', async () => {
    const admission = service()
    const settlement = {
      operationId,
      permitId,
      attemptNumber: 1,
      nonce: 'AQIDBA',
      disposition: 'success',
      reportedDisposition: 'success',
      providerRetryable: false,
      usageKnown: true,
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 5,
      reasoningTokens: 1,
      retryAfterSeconds: null,
    } as const
    const response = await handleAiExecutionAdmissionRequest({
      request: request('/v1/settle', JSON.stringify(settlement)),
      peerIdentity: GATEWAY,
      expectedGatewayIdentity: GATEWAY,
      service: admission,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'permit_unknown' })
    expect(admission.settle).toHaveBeenCalledWith(settlement)
  })

  it('rejects an unexpected peer before parsing the body', async () => {
    const admission = service()
    const response = await handleAiExecutionAdmissionRequest({
      request: request('/v1/settle', '{'),
      peerIdentity: 'spiffe://repkey.internal/repkey-worker',
      expectedGatewayIdentity: GATEWAY,
      service: admission,
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'unauthorized' })
    expect(admission.settle).not.toHaveBeenCalled()
  })

  it('fails duplicate JSON fields and query-bearing routes closed', async () => {
    const admission = service()
    const duplicate = `{"operationId":"${operationId}","operationId":"${operationId}"}`
    const malformed = await handleAiExecutionAdmissionRequest({
      request: request('/v1/settle', duplicate),
      peerIdentity: GATEWAY,
      expectedGatewayIdentity: GATEWAY,
      service: admission,
    })
    const routed = await handleAiExecutionAdmissionRequest({
      request: request('/v1/settle?retry=1', '{}'),
      peerIdentity: GATEWAY,
      expectedGatewayIdentity: GATEWAY,
      service: admission,
    })

    expect(malformed.status).toBe(400)
    await expect(malformed.json()).resolves.toEqual({
      ok: false,
      code: 'malformed_request',
    })
    expect(routed.status).toBe(404)
    expect(admission.settle).not.toHaveBeenCalled()
  })

  it('reports database readiness without accepting request bodies', async () => {
    const admission = service()
    const response = await handleAiExecutionAdmissionRequest({
      request: new Request('https://internal.invalid/health/ready'),
      peerIdentity: null,
      expectedGatewayIdentity: GATEWAY,
      service: admission,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(admission.readiness).toHaveBeenCalledOnce()
  })
})
