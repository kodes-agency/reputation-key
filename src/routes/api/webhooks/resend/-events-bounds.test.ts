// The webhook route's input bounds: an oversized body is refused before it is
// parsed or applied, whether or not the sender declared its length, and a body
// signed with the wrong key is refused outright.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { signSvixPayload } from '#/shared/auth/svix-signature.verifier'
import { handleResendWebhookPost } from './events'

const SECRET = `whsec_${Buffer.from('resend-webhook-signing-key').toString('base64')}`
const OTHER_SECRET = `whsec_${Buffer.from('some-other-signing-key').toString('base64')}`

const mocks = vi.hoisted(() => ({ handleResendEvent: vi.fn() }))

vi.mock('#/shared/observability/trace', () => ({
  trace: (_name: string, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('#/shared/config/env', () => ({
  getEnv: () => ({ RESEND_WEBHOOK_SECRET: SECRET }),
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({ handleResendEvent: mocks.handleResendEvent }),
}))

const OVERSIZED = JSON.stringify({
  type: 'email.delivered',
  data: { email_id: 'prov-1', padding: 'x'.repeat(70 * 1024) },
})

const signedHeaders = (rawBody: string, secret = SECRET) => {
  const id = 'msg_bounds'
  const timestamp = String(Math.floor(Date.now() / 1000))
  return {
    'svix-id': id,
    'svix-timestamp': timestamp,
    'svix-signature': signSvixPayload({ id, timestamp, rawBody, signingSecret: secret }),
  }
}

const URL = 'https://app.test/api/webhooks/resend/events'

describe('resend webhook route bounds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refuses a body whose declared length is over the limit', async () => {
    const request = new Request(URL, {
      method: 'POST',
      headers: {
        ...signedHeaders(OVERSIZED),
        'content-length': String(OVERSIZED.length),
      },
      body: OVERSIZED,
    })
    const read = vi.spyOn(request, 'text')

    const response = await handleResendWebhookPost(request)

    expect(response.status).toBe(413)
    expect(read).not.toHaveBeenCalled()
    expect(mocks.handleResendEvent).not.toHaveBeenCalled()
  })

  it('stops reading a body that grows past the limit without declaring it', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(16 * 1024))
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        controller.enqueue(chunk)
      },
    })
    const request = new Request(URL, {
      method: 'POST',
      headers: signedHeaders(OVERSIZED),
      body,
      duplex: 'half',
    } as RequestInit)

    const response = await handleResendWebhookPost(request)

    expect(response.status).toBe(413)
    expect(pulled).toBeLessThan(10)
    expect(mocks.handleResendEvent).not.toHaveBeenCalled()
  })

  it('refuses a body signed with another key', async () => {
    const body = JSON.stringify({ type: 'email.bounced', data: { email_id: 'prov-1' } })
    const request = new Request(URL, {
      method: 'POST',
      headers: signedHeaders(body, OTHER_SECRET),
      body,
    })

    const response = await handleResendWebhookPost(request)

    expect(response.status).toBe(401)
    expect(mocks.handleResendEvent).not.toHaveBeenCalled()
  })
})
