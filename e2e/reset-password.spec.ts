// E2E: Password reset request flow (BQR-5.2, hardened BQC-6.7).
// AuthCard titles are divs — assert by text, not heading role.
//
// The fake outbox (e2e/fixtures/mail-stub.ts) proves the reset email: exactly
// one reset-classified send to the requested address. The placeholder-error
// tolerance is DELETED — the mail path runs against the stub, never Resend.

import { test, expect } from './helpers/error-detection'
import { waitForHydration, clickWhenReady } from './helpers/interaction'
import { mailStubControl } from './fixtures/mail-stub'

test.describe('Password Reset', () => {
  test.beforeEach(async () => {
    await mailStubControl.reset()
  })

  test('request password reset for existing email', async ({ page }) => {
    const testEmail = process.env.E2E_TEST_EMAIL ?? 'test@example.com'

    await page.goto('/reset-password')
    await waitForHydration(page)
    await expect(page.getByText(/reset your password/i)).toBeVisible()

    await page.getByLabel('Email').fill(testEmail)
    await clickWhenReady(page.getByRole('button', { name: /send reset link/i }))

    // Success card (AuthCard title is a div) — always renders now: the send
    // cannot fail closed on a placeholder provider key.
    await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(testEmail)).toBeVisible()

    // Fake outbox: exactly one send, reset classification (subject), correct
    // recipient.
    await expect
      .poll(async () => (await mailStubControl.sends()).length, { timeout: 15_000 })
      .toBe(1)
    const [send] = await mailStubControl.sends()
    expect(send.to).toBe(testEmail)
    expect(send.subject).toContain('Reset your password')
  })
})
