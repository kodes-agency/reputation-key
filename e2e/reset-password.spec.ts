// E2E: Password reset request flow

import { test, expect } from '@playwright/test'

test.describe('Password Reset', () => {
  test('request password reset for existing email', async ({ page }) => {
    const testEmail = process.env.E2E_TEST_EMAIL ?? 'test@example.com'

    await page.goto('/reset-password')
    await expect(
      page.getByRole('heading', { name: /reset your password/i }),
    ).toBeVisible()

    await page.getByLabel('Email').fill(testEmail)
    await page.getByRole('button', { name: /send reset link/i }).click()

    // Should show confirmation regardless of whether email exists (security)
    await expect(page.getByText(/check your email/i)).toBeVisible()
    await expect(page.getByText(testEmail)).toBeVisible()
  })
})
