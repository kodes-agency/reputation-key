// A route that catches its own failure and answers 500 never throws, so the
// Nitro error hook and Sentry's request middleware never see it. These two
// answer a mail provider and a mail client, which retry or give up in silence:
// the capture has to happen where the 500 is chosen.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createOneClickUnsubscribeToken } from '#/contexts/feed/application/one-click-unsubscribe-token'
import { signSvixPayload } from '#/shared/auth/svix-signature.verifier'

const KEYS = `v1:${'11'.repeat(32)}`
const SECRET = `whsec_${Buffer.from('resend-webhook-signing-key').toString('base64')}`

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  oneClickUnsubscribe: vi.fn(),
  handleResendEvent: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('#/shared/observability/telemetry', () => ({
  captureObservabilityException: mocks.capture,
}))
vi.mock('#/shared/observability/trace', () => ({
  trace: (_name: string, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('#/shared/observability/logger', () => ({ getLogger: () => mocks.logger }))
vi.mock('#/shared/config/request-runtime-config', () => ({
  requestRuntimeConfig: () => ({
    notificationUnsubscribeHmacKeys: KEYS,
    resendWebhookSecret: SECRET,
  }),
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    handleResendEvent: mocks.handleResendEvent,
    feedPublicApi: { oneClickUnsubscribe: mocks.oneClickUnsubscribe },
  }),
}))

const { Route: UnsubscribeRoute } = await import('./notifications/unsubscribe')
const { handleResendWebhookPost } = await import('./webhooks/resend/events')

type RouteHandler = (context: { request: Request }) => Promise<Response>

const unsubscribePost = (request: Request) =>
  (
    UnsubscribeRoute.options as unknown as {
      server: { handlers: Record<string, RouteHandler> }
    }
  ).server.handlers.POST!({ request })

function oneClickRequest(): Request {
  const token = createOneClickUnsubscribeToken(KEYS, {
    kind: 'email',
    id: '86000000-0000-4000-8000-000000000011',
  })
  return new Request(
    `https://app.example.com/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    },
  )
}

function resendRequest(): Request {
  const rawBody = JSON.stringify({ type: 'email.bounced', data: { email_id: 'prov-1' } })
  const id = 'msg_2abc'
  const timestamp = String(Math.floor(Date.now() / 1000))
  return new Request('https://app.test/api/webhooks/resend/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': signSvixPayload({
        id,
        timestamp,
        rawBody,
        signingSecret: SECRET,
      }),
    },
    body: rawBody,
  })
}

describe('a route that answers its own failure with a 500', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports a failed one-click unsubscribe write to the error monitor', async () => {
    const failure = new Error('preference write failed')
    mocks.oneClickUnsubscribe.mockRejectedValue(failure)

    const response = await unsubscribePost(oneClickRequest())

    expect(response.status).toBe(500)
    expect(mocks.capture).toHaveBeenCalledWith(failure, { source: 'nitro' })
  })

  it('reports a failed Resend event to the error monitor', async () => {
    const failure = new Error('delivery fact write failed')
    mocks.handleResendEvent.mockRejectedValue(failure)

    const response = await handleResendWebhookPost(resendRequest())

    expect(response.status).toBe(500)
    expect(mocks.capture).toHaveBeenCalledWith(failure, { source: 'nitro' })
  })

  it('leaves a refused request out of the error monitor', async () => {
    const unsigned = new Request('https://app.test/api/webhooks/resend/events', {
      method: 'POST',
      body: 'not json',
    })

    expect((await handleResendWebhookPost(unsigned)).status).toBe(401)
    expect(mocks.capture).not.toHaveBeenCalled()
  })
})
