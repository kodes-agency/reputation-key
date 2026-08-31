import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_PROVIDER_FIXTURES_V1,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
} from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JOSEError } from 'jose/errors'
import { handleGbpWebhookPost } from './notifications'

const LOCATION_ID =
  GOOGLE_PROVIDER_FIXTURES_V1['google-location-primary'].expectedSegments.locationId
const PUSH_SERVICE_ACCOUNT = 'gbp-push@rk-project.iam.gserviceaccount.com'
const TOPIC = 'projects/rk-project/topics/gbp-reviews'

const mocks = vi.hoisted(() => ({
  verifyPubSubJwt: vi.fn(),
  handleGbpNotification: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  env: {
    GBP_PUBSUB_AUDIENCE: 'https://test.example/webhooks/gbp',
    GBP_PUBSUB_TOPIC: 'projects/rk-project/topics/gbp-reviews',
    GBP_PUBSUB_PUSH_SERVICE_ACCOUNT: 'gbp-push@rk-project.iam.gserviceaccount.com',
  },
}))

vi.mock('#/shared/observability/trace', () => ({
  trace: (_name: string, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('#/shared/observability/logger', () => ({ getLogger: () => mocks.logger }))
vi.mock('#/shared/config/env', () => ({ getEnv: () => mocks.env }))
vi.mock('#/shared/auth/pubsub-jwt.verifier', () => ({
  verifyPubSubJwt: mocks.verifyPubSubJwt,
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    integrationWebhookRuntime: {
      handleNotification: mocks.handleGbpNotification,
    },
  }),
}))

const encodePayload = (payload: unknown): string =>
  Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')

const mkRequest = (body: unknown, auth: string | null = 'Bearer valid-token') =>
  new Request('https://test.example/api/webhooks/gbp/notifications', {
    method: 'POST',
    headers: auth ? { Authorization: auth } : {},
    body: JSON.stringify(body),
  })

const VALID_PAYLOAD = Object.freeze({
  locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
  reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
})
const validBody = Object.freeze({
  message: {
    data: encodePayload(VALID_PAYLOAD),
    messageId: 'm-1',
    attributes: { notificationType: 'NEW_REVIEW' },
  },
})

describe('POST /api/webhooks/gbp/notifications', () => {
  beforeEach(() => {
    mocks.verifyPubSubJwt.mockReset()
    mocks.handleGbpNotification.mockReset()
    mocks.logger.warn.mockReset()
    mocks.logger.error.mockReset()
    mocks.env.GBP_PUBSUB_TOPIC = TOPIC
    mocks.env.GBP_PUBSUB_PUSH_SERVICE_ACCOUNT = PUSH_SERVICE_ACCOUNT
    mocks.verifyPubSubJwt.mockResolvedValue({
      sub: 'svc',
      email: PUSH_SERVICE_ACCOUNT,
      emailVerified: true,
      aud: 'https://test.example/webhooks/gbp',
      iat: 0,
      exp: 0,
    })
    mocks.handleGbpNotification.mockResolvedValue({
      accepted: true,
      duplicate: false,
      handoff: 'targeted',
    })
  })

  it('returns 401 before parsing when the Authorization header is absent', async () => {
    const response = await handleGbpWebhookPost(mkRequest(validBody, null))
    expect(response.status).toBe(401)
    expect(mocks.verifyPubSubJwt).not.toHaveBeenCalled()
  })

  it('returns retryable 503 when topic or exact push identity is not configured', async () => {
    mocks.env.GBP_PUBSUB_PUSH_SERVICE_ACCOUNT = ''
    const response = await handleGbpWebhookPost(mkRequest(validBody))
    expect(response.status).toBe(503)
    expect(mocks.verifyPubSubJwt).not.toHaveBeenCalled()
  })

  it('returns 401 when JWT verification fails', async () => {
    mocks.verifyPubSubJwt.mockRejectedValue(new JOSEError('bad signature'))
    const response = await handleGbpWebhookPost(mkRequest(validBody))
    expect(response.status).toBe(401)
    expect(mocks.handleGbpNotification).not.toHaveBeenCalled()
  })

  it('requires both the pinned email and its verified claim', async () => {
    mocks.verifyPubSubJwt.mockResolvedValue({
      sub: 'svc',
      email: PUSH_SERVICE_ACCOUNT,
      emailVerified: false,
      aud: 'https://test.example/webhooks/gbp',
      iat: 0,
      exp: 0,
    })
    const response = await handleGbpWebhookPost(mkRequest(validBody))
    expect(response.status).toBe(401)
    expect(mocks.handleGbpNotification).not.toHaveBeenCalled()
  })

  it('requires a Pub/Sub messageId instead of collapsing deliveries to unknown', async () => {
    const response = await handleGbpWebhookPost(
      mkRequest({ message: { data: encodePayload(VALID_PAYLOAD) } }),
    )
    expect(response.status).toBe(400)
    expect(mocks.handleGbpNotification).not.toHaveBeenCalled()
  })

  it.each(['!!!!', 'YQ=', 'YR=='])(
    'rejects non-canonical base64 data %s',
    async (data) => {
      const response = await handleGbpWebhookPost(
        mkRequest({ message: { data, messageId: 'm-malformed-base64' } }),
      )
      expect(response.status).toBe(400)
      expect(mocks.handleGbpNotification).not.toHaveBeenCalled()
    },
  )

  it('rejects a review resource whose embedded location differs from locationName', async () => {
    const response = await handleGbpWebhookPost(
      mkRequest({
        message: {
          data: encodePayload({
            ...VALID_PAYLOAD,
            reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE.replace(
              `/locations/${LOCATION_ID}/`,
              '/locations/different-location/',
            ),
          }),
          messageId: 'm-cross-location',
        },
      }),
    )
    expect(response.status).toBe(400)
    expect(mocks.handleGbpNotification).not.toHaveBeenCalled()
  })

  it('rejects notification kinds outside NEW_REVIEW and UPDATED_REVIEW', async () => {
    const response = await handleGbpWebhookPost(
      mkRequest({
        message: {
          ...validBody.message,
          attributes: { notificationType: 'NEW_QUESTION' },
        },
      }),
    )
    expect(response.status).toBe(400)
  })

  it('durably delegates canonical review identifiers and acknowledges only afterward', async () => {
    const response = await handleGbpWebhookPost(mkRequest(validBody))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      duplicate: false,
      handoff: 'targeted',
    })
    expect(mocks.handleGbpNotification).toHaveBeenCalledWith({
      topic: TOPIC,
      messageId: 'm-1',
      notificationKind: 'NEW_REVIEW',
      locationId: LOCATION_ID,
      locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
      reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
    })
  })

  it('uses the honest combined kind when Google omits a kind field', async () => {
    await handleGbpWebhookPost(
      mkRequest({ message: { data: encodePayload(VALID_PAYLOAD), messageId: 'm-2' } }),
    )
    expect(mocks.handleGbpNotification).toHaveBeenCalledWith(
      expect.objectContaining({ notificationKind: 'REVIEW_CHANGED' }),
    )
  })

  it('returns 500 so Pub/Sub retries when durable receipt commit fails', async () => {
    mocks.handleGbpNotification.mockRejectedValue(new Error('database unavailable'))
    const response = await handleGbpWebhookPost(mkRequest(validBody))
    expect(response.status).toBe(500)
  })
})
