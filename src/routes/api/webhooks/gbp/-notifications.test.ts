// GBP Pub/Sub webhook route — integration test for the POST handler.
// Exercises each response branch: missing-auth (401), bad JWT (401), malformed
// payload (400), happy path (200), and internal error (500). The finding
// (ctx-integration MAJOR #7 / cc-errors §12) flagged the collapsed 500 + the
// missing route-level coverage; this test pins the per-branch behavior.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { JOSEError } from 'jose/errors'
import { handleGbpWebhookPost } from './notifications'

// Hoisted mocks so vi.mock factories (which run before imports) can reference them.
const mocks = vi.hoisted(() => ({
  verifyPubSubJwt: vi.fn(),
  handleGbpNotification: vi.fn(),
}))

vi.mock('#/shared/observability/trace', () => ({
  // trace(name, fn) — pass-through so the handler body runs directly.
  trace: (_name: string, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))
vi.mock('#/shared/config/env', () => ({
  getEnv: () => ({ GBP_PUBSUB_AUDIENCE: 'https://test.example/webhooks/gbp' }),
}))
vi.mock('#/shared/auth/pubsub-jwt.verifier', () => ({
  verifyPubSubJwt: mocks.verifyPubSubJwt,
}))

vi.mock(
  '#/contexts/integration/infrastructure/handlers/gbp-notification-handler',
  () => ({
    handleGbpNotification: mocks.handleGbpNotification,
  }),
)

const encodePayload = (payload: unknown): string =>
  Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64')

const mkRequest = (body: unknown, auth: string | null = 'Bearer valid-token'): Request =>
  new Request('https://test.example/api/webhooks/gbp/notifications', {
    method: 'POST',
    headers: auth ? { Authorization: auth } : {},
    body: JSON.stringify(body),
  })

const VALID_PAYLOAD = {
  locationName: 'accounts/1/locations/loc-1',
  reviewName: 'accounts/1/locations/loc-1/reviews/rev-1',
}

const validBody = { message: { data: encodePayload(VALID_PAYLOAD), messageId: 'm-1' } }

describe('POST /api/webhooks/gbp/notifications', () => {
  beforeEach(() => {
    mocks.verifyPubSubJwt.mockReset()
    mocks.handleGbpNotification.mockReset()
    mocks.verifyPubSubJwt.mockResolvedValue({
      sub: 'svc',
      email: '',
      aud: 'https://test.example/webhooks/gbp',
      iat: 0,
      exp: 0,
    })
    mocks.handleGbpNotification.mockResolvedValue({ enqueued: true, reason: null })
  })

  it('returns 401 when the Authorization header has no Bearer prefix', async () => {
    const res = await handleGbpWebhookPost(mkRequest(validBody, null))
    expect(res.status).toBe(401)
    expect(mocks.verifyPubSubJwt).not.toHaveBeenCalled()
  })

  it('returns 401 (not 500) when JWT verification fails with a JOSEError', async () => {
    mocks.verifyPubSubJwt.mockRejectedValue(
      new JOSEError('JWT signature verification failed'),
    )
    const res = await handleGbpWebhookPost(mkRequest(validBody))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('Unauthorized')
    expect(mocks.handleGbpNotification).not.toHaveBeenCalled()
  })

  it('returns 400 when the push payload fails schema validation', async () => {
    // message must be an object — a string fails pubSubBodySchema → ZodError.
    const res = await handleGbpWebhookPost(mkRequest({ message: 'not-an-object' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Bad Request')
    expect(mocks.handleGbpNotification).not.toHaveBeenCalled()
  })

  it('returns 400 when the decoded message.data is not valid JSON', async () => {
    // base64 of "not-json" → JSON.parse throws SyntaxError.
    const res = await handleGbpWebhookPost(
      mkRequest({ message: { data: Buffer.from('not-json').toString('base64') } }),
    )
    expect(res.status).toBe(400)
    expect(mocks.handleGbpNotification).not.toHaveBeenCalled()
  })

  it('returns 200 and delegates to handleGbpNotification on the happy path', async () => {
    const res = await handleGbpWebhookPost(mkRequest(validBody))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true, enqueued: true })
    expect(mocks.verifyPubSubJwt).toHaveBeenCalledWith(
      'valid-token',
      'https://test.example/webhooks/gbp',
    )
    expect(mocks.handleGbpNotification).toHaveBeenCalledWith({
      locationId: 'loc-1',
      locationName: 'accounts/1/locations/loc-1',
      messageId: 'm-1',
    })
  })

  it('returns 500 only for true internal errors from the handler', async () => {
    mocks.handleGbpNotification.mockRejectedValue(new Error('DB down'))
    const res = await handleGbpWebhookPost(mkRequest(validBody))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('Internal Server Error')
  })
})
