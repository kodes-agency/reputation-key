// A revoked RESEND_API_KEY (401) or a sending domain whose verification lapsed
// (403) refuses every message, and a permanent refusal is never retried: the
// jobs record it and return, so nothing throws, nothing is quarantined, and the
// count-gated email-permanent-failures alert needs three refusals in a day that
// a one-user Organization may never reach. The refusal names our own
// configuration, not the recipient, so the first one has to reach an operator.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createResendEmailAdapter,
  type ResendEmailClient,
  type ResendSendResult,
} from './resend-email.adapter'
import { createMockLogger } from '#/shared/testing/mock-logger'

const mocks = vi.hoisted(() => ({ capture: vi.fn() }))

vi.mock('#/shared/observability/telemetry', () => ({
  captureObservabilityException: mocks.capture,
}))

function refusedWith(error: NonNullable<ResendSendResult['error']>) {
  const client = {
    emails: {
      send: vi.fn(async (): Promise<ResendSendResult> => ({ data: null, error })),
    },
  } as unknown as ResendEmailClient
  return createResendEmailAdapter({
    config: {
      apiKey: 're_test',
      from: 'Reputation Key <notifications@test.example>',
      appBaseUrl: 'https://app.test',
    },
    logger: createMockLogger(),
    clock: () => new Date('2026-09-28T08:00:00.000Z'),
    clientFactory: () => client,
  })
}

const send = (adapter: ReturnType<typeof refusedWith>) =>
  adapter.send({
    to: 'manager@example.com',
    subject: 'A new review at Riverside',
    html: '<p>A new review</p>',
    text: 'A new review',
    idempotencyKey: 'notification-1:email',
  })

describe('an email provider refusal of our own sender', () => {
  beforeEach(() => mocks.capture.mockReset())

  it.each([
    [401, 'missing_api_key', 'API key is invalid'],
    [403, 'validation_error', 'The test.example domain is not verified'],
  ])(
    'reports a %i refusal to the error monitor on the first message',
    async (statusCode, name, message) => {
      const outcome = await send(refusedWith({ statusCode, name, message }))

      expect(outcome).toMatchObject({ kind: 'rejected', classification: 'permanent' })
      expect(mocks.capture).toHaveBeenCalledOnce()
      const [error, context] = mocks.capture.mock.calls[0]!
      expect(error).toMatchObject({ name: 'EmailProviderRefusedSender' })
      expect(context).toEqual({ source: 'email-provider' })
    },
  )

  it('leaves a refusal of one recipient to the refusal-rate alert', async () => {
    await send(
      refusedWith({
        statusCode: 422,
        name: 'validation_error',
        message: 'Invalid `to` field',
      }),
    )

    expect(mocks.capture).not.toHaveBeenCalled()
  })
})
