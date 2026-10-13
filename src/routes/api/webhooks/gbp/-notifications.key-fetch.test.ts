// The Google push webhook against the real token library, with only the request
// for Google's signing keys replaced. `-notifications.test.ts` hands the route
// the library's error classes by name; here the library produces them, so an
// upgrade that changes what a failed key fetch throws fails in this file.

import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
} from '#/test-fixtures/generated/google-provider-identifiers-v1'

const AUDIENCE = 'https://test.example/webhooks/gbp'
const PUSH_SERVICE_ACCOUNT = 'gbp-push@rk-project.iam.gserviceaccount.com'
const KEY_ID = 'google-signing-key-1'

const mocks = vi.hoisted(() => ({
  handleNotification: vi.fn(),
  capture: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('#/shared/observability/trace', () => ({
  trace: (_name: string, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('#/shared/observability/logger', () => ({ getLogger: () => mocks.logger }))
vi.mock('#/shared/observability/telemetry', () => ({
  captureObservabilityException: mocks.capture,
}))
vi.mock('#/shared/config/env', () => ({
  getEnv: () => ({
    GBP_PUBSUB_AUDIENCE: AUDIENCE,
    GBP_PUBSUB_TOPIC: 'projects/rk-project/topics/gbp-reviews',
    GBP_PUBSUB_PUSH_SERVICE_ACCOUNT: PUSH_SERVICE_ACCOUNT,
  }),
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    integrationWebhookRuntime: { handleNotification: mocks.handleNotification },
  }),
}))

type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>

const googleKey = await generateKeyPair('RS256')
const anotherKey = await generateKeyPair('RS256')

/** The key document Google serves, publishing `key` under `kid`. */
const keySetOf = async (key: SigningKey, kid = KEY_ID) =>
  Response.json({
    keys: [{ ...(await exportJWK(key.publicKey)), kid, alg: 'RS256', use: 'sig' }],
  })

const pushToken = (
  options: Readonly<{ signedBy?: SigningKey; kid?: string; audience?: string }> = {},
) =>
  new SignJWT({ email: PUSH_SERVICE_ACCOUNT, email_verified: true })
    .setProtectedHeader({ alg: 'RS256', kid: options.kid ?? KEY_ID })
    .setIssuer('https://accounts.google.com')
    .setAudience(options.audience ?? AUDIENCE)
    .setSubject('push-identity')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign((options.signedBy ?? googleKey).privateKey)

/**
 * Deliver one valid push. The route and the verifier are loaded fresh, because
 * the verifier keeps its key set, and the keys it fetched, for the process.
 */
const deliver = async (token: string): Promise<Response> => {
  vi.resetModules()
  const { handleGbpWebhookPost } = await import('./notifications')
  return handleGbpWebhookPost(
    new Request('https://test.example/api/webhooks/gbp/notifications', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        message: {
          data: Buffer.from(
            JSON.stringify({
              type: 'NEW_REVIEW',
              location: GOOGLE_LOCATION_PRIMARY_RESOURCE,
              review: GOOGLE_REVIEW_PRIMARY_RESOURCE,
            }),
            'utf8',
          ).toString('base64'),
          messageId: 'm-key-fetch',
        },
      }),
    }),
  )
}

const googleAnswers = (answer: () => Promise<Response>) =>
  vi.stubGlobal('fetch', vi.fn(answer))

describe('POST /api/webhooks/gbp/notifications, with the real token library', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handleNotification.mockResolvedValue({
      accepted: true,
      duplicate: false,
      handoff: 'targeted',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('accepts a push signed by a key Google publishes', async () => {
    googleAnswers(() => keySetOf(googleKey))

    const response = await deliver(await pushToken())

    expect(response.status).toBe(200)
    expect(mocks.handleNotification).toHaveBeenCalledOnce()
  })

  it.each([
    [
      'times out',
      async () => {
        throw new DOMException('The operation timed out', 'TimeoutError')
      },
    ],
    [
      'cannot be reached',
      async () => {
        throw new TypeError('fetch failed')
      },
    ],
    ['answers 503', async () => new Response('unavailable', { status: 503 })],
    ['answers with no JSON', async () => new Response('<html></html>', { status: 200 })],
    ['answers with no key set', async () => Response.json({ error: 'backend_error' })],
  ])(
    "answers 500 and reports it when the request for Google's keys %s",
    async (_case, answer) => {
      googleAnswers(answer)

      const response = await deliver(await pushToken())

      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({
        error: 'Internal Server Error',
        message: 'Unexpected error processing webhook notification',
      })
      expect(mocks.handleNotification).not.toHaveBeenCalled()
      expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(expect.any(Error), {
        source: 'nitro',
      })
    },
  )

  it.each([
    [
      'is signed by a key Google does not publish',
      () => pushToken({ signedBy: anotherKey }),
    ],
    ['names a key id Google does not publish', () => pushToken({ kid: 'retired-key' })],
    [
      'was issued for another audience',
      () => pushToken({ audience: 'https://elsewhere.example/webhooks/gbp' }),
    ],
  ])('answers 401 and reports nothing when the token %s', async (_case, token) => {
    googleAnswers(() => keySetOf(googleKey))

    const response = await deliver(await token())

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: 'Unauthorized',
      message: 'Invalid or expired Pub/Sub JWT',
    })
    expect(mocks.handleNotification).not.toHaveBeenCalled()
    expect(mocks.capture).not.toHaveBeenCalled()
  })
})
