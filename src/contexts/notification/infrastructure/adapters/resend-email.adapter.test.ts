// The adapter's job is to hand the port's whole payload to Resend and classify
// the answer. Three regressions this pins, all of which shipped:
//   - `text` and `headers` were dropped, so the ADR 0046 r.7 List-Unsubscribe
//     guard in the jobs was decorative from the provider's point of view.
//   - `from` was hardcoded, ignoring EMAIL_FROM.
//   - RESEND_BASE_URL was ignored for notification mail even though identity
//     mail honours it, so the documented sandbox seam did not exist here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createResendEmailAdapter,
  type ResendEmailClient,
  type ResendSendPayload,
  type ResendSendResult,
} from './resend-email.adapter'
import { resetEnv } from '#/shared/config/env'

// Mocked so the default factory can be exercised without a network or a key —
// the constructor arguments ARE the sandbox-seam contract under test.
const resendCtor = vi.hoisted(() => vi.fn())
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: vi.fn(async () => ({ data: { id: 'prov-default' }, error: null })) }
    constructor(...args: unknown[]) {
      resendCtor(...args)
    }
  },
}))

const ORIGINAL = {
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_BASE_URL: process.env.RESEND_BASE_URL,
  EMAIL_FROM: process.env.EMAIL_FROM,
}

const request = {
  to: 'manager@example.com',
  subject: 'Approve a reply at Riverside Hotel',
  html: '<p>Approve a reply</p>',
  text: 'Approve a reply',
  idempotencyKey: 'notification-1:email',
  headers: {
    'List-Unsubscribe': '<https://app.test/settings/notifications>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  },
}

function fakeClient(
  answer: ResendSendResult = { data: { id: 'prov-1' }, error: null },
) {
  const send = vi.fn(
    async (
      _payload: ResendSendPayload,
      _options: Readonly<{ idempotencyKey: string }>,
    ): Promise<ResendSendResult> => answer,
  )
  return { client: { emails: { send } } as unknown as ResendEmailClient, send }
}

describe('resend email adapter', () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = 're_live_0123456789abcdef'
    process.env.EMAIL_FROM = 'Reputation Key <notifications@test.example>'
    delete process.env.RESEND_BASE_URL
    resetEnv()
    resendCtor.mockClear()
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(ORIGINAL)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    resetEnv()
  })

  it('forwards the plain-text twin and the unsubscribe headers to the provider', async () => {
    const { client, send } = fakeClient()

    await createResendEmailAdapter(() => client).send(request)

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'manager@example.com',
        text: 'Approve a reply',
        headers: request.headers,
      }),
      { idempotencyKey: 'notification-1:email' },
    )
  })

  it('takes the sender from EMAIL_FROM rather than a hardcoded address', async () => {
    const { client, send } = fakeClient()

    await createResendEmailAdapter(() => client).send(request)

    expect(send.mock.calls[0]![0].from).toBe(
      'Reputation Key <notifications@test.example>',
    )
  })

  it('omits the headers key entirely when there are none, rather than sending {}', async () => {
    const { client, send } = fakeClient()
    const { headers: _omitted, ...withoutHeaders } = request

    await createResendEmailAdapter(() => client).send(withoutHeaders)

    expect(send.mock.calls[0]![0]).not.toHaveProperty('headers')
  })

  it('returns an accepted outcome carrying the provider message id', async () => {
    const { client } = fakeClient()

    const outcome = await createResendEmailAdapter(() => client).send(request)

    expect(outcome).toMatchObject({ kind: 'accepted', providerMessageId: 'prov-1' })
  })

  it('classifies a rate-limit rejection as transient', async () => {
    const { client } = fakeClient({
      data: null,
      error: { name: 'rate_limit_exceeded', statusCode: 429, message: 'slow down' },
    })

    const outcome = await createResendEmailAdapter(() => client).send(request)

    expect(outcome).toMatchObject({ kind: 'rejected', classification: 'transient' })
  })

  it('treats a 200 with no id as a rejection rather than a silent success', async () => {
    const { client } = fakeClient({ data: null, error: null })

    const outcome = await createResendEmailAdapter(() => client).send(request)

    expect(outcome.kind).toBe('rejected')
  })

  it('builds the client once and reuses it across sends', async () => {
    const { client } = fakeClient()
    const factory = vi.fn(() => client)
    const adapter = createResendEmailAdapter(factory)

    await adapter.send(request)
    await adapter.send(request)

    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('points the real client at RESEND_BASE_URL — the seam identity mail already honours', async () => {
    process.env.RESEND_BASE_URL = 'http://localhost:4101'
    resetEnv()

    await createResendEmailAdapter().send(request)

    expect(resendCtor).toHaveBeenCalledWith('re_live_0123456789abcdef', {
      baseUrl: 'http://localhost:4101',
    })
  })

  it('falls back to the SDK default when RESEND_BASE_URL is absent', async () => {
    await createResendEmailAdapter().send(request)

    expect(resendCtor).toHaveBeenCalledWith('re_live_0123456789abcdef')
  })
})
