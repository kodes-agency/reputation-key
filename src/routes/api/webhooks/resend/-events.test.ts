// Resend delivery-event webhook route — integration test for the POST handler.
// Exercises each response branch: unset secret (503 disabled), forged signature
// (401), malformed body (400), happy path (200), and internal failure (500).
// The real Svix verifier runs — mocking it would leave the one security-
// relevant line of this route untested.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { signSvixPayload } from '#/shared/auth/svix-signature.verifier'
import { handleResendWebhookPost } from './events'

const SECRET = `whsec_${Buffer.from('resend-webhook-signing-key').toString('base64')}`

const mocks = vi.hoisted(() => ({
  handleResendEvent: vi.fn(),
  secret: { value: undefined as string | undefined },
}))

vi.mock('#/shared/observability/trace', () => ({
  trace: (_name: string, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('#/shared/config/env', () => ({
  getEnv: () => ({ RESEND_WEBHOOK_SECRET: mocks.secret.value }),
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({ handleResendEvent: mocks.handleResendEvent }),
}))

const body = JSON.stringify({
  type: 'email.bounced',
  created_at: '2026-08-21T09:05:00.000Z',
  data: { email_id: 'prov-1' },
})

const mkRequest = (
  rawBody: string = body,
  overrides: Partial<{ id: string; timestamp: string; signature: string }> = {},
): Request => {
  const id = overrides.id ?? 'msg_2abc'
  const timestamp = overrides.timestamp ?? String(Math.floor(Date.now() / 1000))
  const signature =
    overrides.signature ??
    signSvixPayload({ id, timestamp, rawBody, signingSecret: SECRET })
  return new Request('https://app.test/api/webhooks/resend/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': signature,
    },
    body: rawBody,
  })
}

describe('resend webhook route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.secret.value = SECRET
    mocks.handleResendEvent.mockResolvedValue({ applied: true, rows: 1, suppressed: 3 })
  })

  it('stays dark with a clear reason when the signing secret is unset', async () => {
    mocks.secret.value = undefined

    const response = await handleResendWebhookPost(mkRequest())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ code: 'webhook_disabled' })
    expect(mocks.handleResendEvent).not.toHaveBeenCalled()
  })

  it('accepts a correctly signed event and forwards it to the handler', async () => {
    const response = await handleResendWebhookPost(mkRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      applied: true,
      suppressed: 3,
    })
    expect(mocks.handleResendEvent).toHaveBeenCalledWith({
      type: 'email.bounced',
      providerMessageId: 'prov-1',
      occurredAt: new Date('2026-08-21T09:05:00.000Z'),
      eventId: 'msg_2abc',
    })
  })

  it('rejects a forged signature with 401 and never reaches the handler', async () => {
    const response = await handleResendWebhookPost(
      mkRequest(body, { signature: 'v1,ZGVhZGJlZWY=' }),
    )

    expect(response.status).toBe(401)
    expect(mocks.handleResendEvent).not.toHaveBeenCalled()
  })

  it('rejects a body tampered with after signing', async () => {
    const id = 'msg_2abc'
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = signSvixPayload({
      id,
      timestamp,
      rawBody: body,
      signingSecret: SECRET,
    })
    const tampered = body.replace('prov-1', 'prov-2')

    const response = await handleResendWebhookPost(
      mkRequest(tampered, { id, timestamp, signature }),
    )

    expect(response.status).toBe(401)
    expect(mocks.handleResendEvent).not.toHaveBeenCalled()
  })

  it('returns 400 for a signed but malformed payload', async () => {
    const response = await handleResendWebhookPost(mkRequest('{"type":"email.bounced"}'))

    expect(response.status).toBe(400)
    expect(mocks.handleResendEvent).not.toHaveBeenCalled()
  })

  it('returns 400 for signed non-JSON', async () => {
    expect((await handleResendWebhookPost(mkRequest('not json'))).status).toBe(400)
  })

  it('falls back to receipt time when the provider timestamp is unparseable', async () => {
    await handleResendWebhookPost(
      mkRequest(
        JSON.stringify({
          type: 'email.delivered',
          created_at: 'never',
          data: { email_id: 'prov-1' },
        }),
      ),
    )

    const [input] = mocks.handleResendEvent.mock.calls[0] as [{ occurredAt: Date }]
    expect(Number.isNaN(input.occurredAt.getTime())).toBe(false)
  })

  it('acks an ignored event with 200 — a retry cannot change the outcome', async () => {
    mocks.handleResendEvent.mockResolvedValue({
      applied: false,
      rows: 0,
      suppressed: 0,
      reason: 'ignored_event_type',
    })

    const response = await handleResendWebhookPost(mkRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      reason: 'ignored_event_type',
    })
  })

  it('surfaces an internal failure as 500, distinguishable from a probing client', async () => {
    mocks.handleResendEvent.mockRejectedValue(new Error('database is down'))

    const response = await handleResendWebhookPost(mkRequest())

    expect(response.status).toBe(500)
  })
})
