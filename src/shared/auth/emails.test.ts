// Unit tests for the Resend client construction seam (BQC-6.7).
// RESEND_BASE_URL absent → the SDK default (byte-identical pre-seam behavior);
// set → the client targets the override (the e2e mail stub proves end-to-end).
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

const ORIGINAL_RESEND_BASE_URL = process.env.RESEND_BASE_URL

describe('emails Resend client seam', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.RESEND_BASE_URL
  })

  afterEach(() => {
    if (ORIGINAL_RESEND_BASE_URL === undefined) {
      delete process.env.RESEND_BASE_URL
    } else {
      process.env.RESEND_BASE_URL = ORIGINAL_RESEND_BASE_URL
    }
  })

  it('RESEND_BASE_URL absent → SDK default base URL (pre-seam behavior)', async () => {
    const { resetEnv } = await import('#/shared/config/env')
    resetEnv()
    const { getResend, resetEmailClient } = await import('#/shared/auth/emails')
    resetEmailClient()

    expect(getResend().baseUrl).toBe('https://api.resend.com')
  })

  it('RESEND_BASE_URL set → client targets the override', async () => {
    process.env.RESEND_BASE_URL = 'http://localhost:4101'
    const { resetEnv } = await import('#/shared/config/env')
    resetEnv()
    const { getResend, resetEmailClient } = await import('#/shared/auth/emails')
    resetEmailClient()

    expect(getResend().baseUrl).toBe('http://localhost:4101')
  })
})
