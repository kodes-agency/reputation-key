// GBP Pub/Sub webhook route — integration test for the POST handler.
// Exercises each response branch: missing-auth (401), bad JWT (401), malformed
// payload (400), happy path (200), and internal error (500). The finding
// (ctx-integration MAJOR #7 / cc-errors §12) flagged the collapsed 500 + the
// missing route-level coverage; this test pins the per-branch behavior.

import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_PROVIDER_FIXTURES_V1,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
} from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { JOSEError } from 'jose/errors'
import { handleGbpWebhookPost } from './notifications'
const LOCATION_ID =
  GOOGLE_PROVIDER_FIXTURES_V1['google-location-primary'].expectedSegments.locationId

// Hoisted mocks so vi.mock factories (which run before imports) can reference them.
const mocks = vi.hoisted(() => ({
  verifyPubSubJwt: vi.fn(),
  handleGbpNotification: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  // Mutable so a test can flip the pinning posture; the route reads getEnv()
  // per request.
  env: {
    GBP_PUBSUB_AUDIENCE: 'https://test.example/webhooks/gbp',
    GBP_PUBSUB_PUSH_SERVICE_ACCOUNT: undefined as string | undefined,
  },
}))

vi.mock('#/shared/observability/trace', () => ({
  // trace(name, fn) — pass-through so the handler body runs directly.
  trace: (_name: string, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => mocks.logger,
}))
vi.mock('#/shared/config/env', () => ({
  getEnv: () => mocks.env,
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
  locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
  reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
}

const validBody = { message: { data: encodePayload(VALID_PAYLOAD), messageId: 'm-1' } }
const PUSH_SERVICE_ACCOUNT = 'gbp-push@rk-project.iam.gserviceaccount.com'

describe('POST /api/webhooks/gbp/notifications', () => {
  beforeEach(() => {
    mocks.verifyPubSubJwt.mockReset()
    mocks.handleGbpNotification.mockReset()
    mocks.logger.warn.mockReset()
    mocks.env.GBP_PUBSUB_PUSH_SERVICE_ACCOUNT = undefined
    mocks.verifyPubSubJwt.mockResolvedValue({
      sub: 'svc',
      email: PUSH_SERVICE_ACCOUNT,
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
      locationId: LOCATION_ID,
      locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
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

  // GBP_PUBSUB_PUSH_SERVICE_ACCOUNT: audience alone accepts any Google-issued
  // OIDC token minted for our audience, so the push identity is the gate that
  // distinguishes OUR subscription from an unrelated project's.
  describe('push identity pinning', () => {
    it('returns 401 when the email claim does not match the pinned service account', async () => {
      mocks.env.GBP_PUBSUB_PUSH_SERVICE_ACCOUNT = PUSH_SERVICE_ACCOUNT
      mocks.verifyPubSubJwt.mockResolvedValue({
        sub: 'svc',
        email: 'attacker@someone-elses-project.iam.gserviceaccount.com',
        aud: 'https://test.example/webhooks/gbp',
        iat: 0,
        exp: 0,
      })

      const res = await handleGbpWebhookPost(mkRequest(validBody))

      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({
        error: 'Unauthorized',
        message: 'Unrecognized Pub/Sub push identity',
      })
      expect(mocks.handleGbpNotification).not.toHaveBeenCalled()
      // BQC-1.6: the rejection log carries no identity material.
      const logged = JSON.stringify(mocks.logger.warn.mock.calls)
      expect(logged).not.toContain('someone-elses-project')
      expect(logged).not.toContain(PUSH_SERVICE_ACCOUNT)
    })

    it('returns 401 when the pinned account is set and the token carries no email claim', async () => {
      mocks.env.GBP_PUBSUB_PUSH_SERVICE_ACCOUNT = PUSH_SERVICE_ACCOUNT
      mocks.verifyPubSubJwt.mockResolvedValue({
        sub: 'svc',
        email: '',
        aud: 'https://test.example/webhooks/gbp',
        iat: 0,
        exp: 0,
      })

      const res = await handleGbpWebhookPost(mkRequest(validBody))

      expect(res.status).toBe(401)
      expect(mocks.handleGbpNotification).not.toHaveBeenCalled()
    })

    it('accepts a matching pinned service account', async () => {
      mocks.env.GBP_PUBSUB_PUSH_SERVICE_ACCOUNT = PUSH_SERVICE_ACCOUNT

      const res = await handleGbpWebhookPost(mkRequest(validBody))

      expect(res.status).toBe(200)
      expect(mocks.handleGbpNotification).toHaveBeenCalledTimes(1)
    })

    it('still delivers when the var is unset, whatever identity signed the token', async () => {
      mocks.verifyPubSubJwt.mockResolvedValue({
        sub: 'svc',
        email: 'some-other@project.iam.gserviceaccount.com',
        aud: 'https://test.example/webhooks/gbp',
        iat: 0,
        exp: 0,
      })

      const res = await handleGbpWebhookPost(mkRequest(validBody))

      expect(res.status).toBe(200)
      expect(mocks.handleGbpNotification).toHaveBeenCalledTimes(1)
    })
  })
})
