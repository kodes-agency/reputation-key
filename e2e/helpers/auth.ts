// E2E auth helpers — shared login/registration utilities

import { expect, type Page } from '@playwright/test'

export const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? 'test@example.com'
export const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD ?? 'password123'

/**
 * Sign in via the better-auth HTTP API so Set-Cookie is applied to the browser
 * context. UI server-fn sign-in has historically failed to propagate cookies in
 * CI, which made every authenticated e2e suite time out for ~18 minutes.
 */
export async function signIn(page: Page, email = TEST_EMAIL, password = TEST_PASSWORD) {
  const response = await page.request.post('/api/auth/sign-in/email', {
    data: { email, password },
    headers: { 'content-type': 'application/json' },
  })
  if (!response.ok()) {
    const body = await response.text()
    throw new Error(
      `E2E sign-in API failed (${response.status()}): ${body.slice(0, 300)}. ` +
        `Ensure scripts/seed-e2e-user.ts ran and credentials match E2E_TEST_*.`,
    )
  }
  // Cookie jar is updated; load an authenticated route.
  await page.goto('/dashboard')
  await page.waitForURL(/\/(dashboard|properties|home|inbox)/, { timeout: 20_000 })
}

/** Register a new account with a unique email. Returns the email used. */
export async function registerAccount(
  page: Page,
  email: string,
  password = 'Password123!',
) {
  await page.goto('/register')
  await page.waitForLoadState('domcontentloaded')
  if (page.url().includes('/login')) {
    throw new Error(
      'Registration is capability-gated off (redirected to /login). ' +
        'Set BETA_E2E_GLOBAL_CAPABILITIES=identity.register,organization.create for e2e.',
    )
  }
  await page.locator('form').first().waitFor({ state: 'visible' })
  await page.getByLabel('Full name').fill('E2E Test User')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Organization name').fill('E2E Test Org')
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm password').fill(password)
  await page.getByRole('button', { name: /create account/i }).click()
  // Success renders on /register — no redirect. Wait for the success card.
  await expect(page.getByText(/account created/i)).toBeVisible({ timeout: 15_000 })
  return email
}
