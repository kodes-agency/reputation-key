// Identity mail is mandatory: it travels through the shared Resend transport and
// never consults the gate that switches optional notification email off.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ send: vi.fn(), optionalGate: vi.fn() }))

vi.mock('#/shared/email/resend-transport', () => ({
  createResendTransport: () => ({ emails: { send: mocks.send } }),
}))
vi.mock('#/shared/auth/beta-capabilities', () => ({
  isCapabilityJobEnabled: mocks.optionalGate,
}))
vi.mock('#/shared/config/env', () => ({
  getEnv: () => ({
    RESEND_API_KEY: 're_test',
    EMAIL_FROM: 'Reputation Key <hello@mail.example.com>',
    BETTER_AUTH_URL: 'https://app.example.com',
  }),
}))
vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

describe('identity mail while optional email is off', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.optionalGate.mockReturnValue(false)
    mocks.send.mockResolvedValue({ data: { id: 'sent-1' }, error: null })
  })

  it('still sends a password reset from the configured sender', async () => {
    const { resetEmailClient, sendResetPasswordEmail } = await import('./emails')
    resetEmailClient()

    await sendResetPasswordEmail('person@example.com', 'https://app.example.com/reset')

    expect(mocks.send).toHaveBeenCalledOnce()
    expect(mocks.send.mock.calls[0]?.[0]).toMatchObject({
      from: 'Reputation Key <hello@mail.example.com>',
      to: 'person@example.com',
    })
    expect(mocks.optionalGate).not.toHaveBeenCalled()
  })
})
