// E2E: Password reset request flow (BQR-5.2, hardened BQC-6.7).
// AuthCard titles are divs — assert by text, not heading role.
//
// The fake outbox (e2e/fixtures/mail-stub.ts) proves the reset email: exactly
// one reset-classified send to the requested address. The placeholder-error
// tolerance is DELETED — the mail path runs against the stub, never Resend.

import { test, expect } from './helpers/error-detection'
import { waitForHydration, clickWhenReady } from './helpers/interaction'
import { mailStubControl } from './fixtures/mail-stub'
import { TEST_EMAIL, TEST_PASSWORD } from './helpers/auth'

function extractResetLink(html: string): string {
  const href = html.match(/href="([^"]+)"[^>]*>Reset Password<\/a>/)?.[1]
  if (!href) throw new Error('Reset email does not contain a Reset Password link')
  return href.replaceAll('&amp;', '&')
}

test.describe('Password Reset', () => {
  test.beforeEach(async () => {
    await mailStubControl.reset()
  })

  test('resets the password through the emailed link', async ({ page }) => {
    const testEmail = TEST_EMAIL

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

    const resetLink = extractResetLink(send.html)
    await page.goto(resetLink)
    await expect(page).toHaveURL(/\/reset-password\?token=[^&]+$/)
    await expect(page.getByText(/choose a new password/i)).toBeVisible()

    await page.getByLabel('New password').fill(TEST_PASSWORD)
    await page.getByLabel('Confirm password').fill(TEST_PASSWORD)
    await clickWhenReady(page.getByRole('button', { name: /save new password/i }))

    await expect(page.getByText(/password updated/i)).toBeVisible()

    await page
      .getByRole('main')
      .getByRole('link', { name: /^sign in$/i })
      .click()
    await page.getByLabel('Email').fill(TEST_EMAIL)
    await page.getByLabel('Password').fill(TEST_PASSWORD)
    await clickWhenReady(page.getByRole('button', { name: /^sign in$/i }))
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })
  })
})
