// E2E auth helpers — shared login/registration utilities

import { expect, type Page } from '@playwright/test'

export const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? 'test@example.com'
export const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD ?? 'password123'

/** Wait until the client form handlers are attached (avoids native GET submit). */
async function waitForClientForm(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  // Controlled React inputs are hydrated when the form has a non-null action
  // handler via React's event system — proxy: form exists and a field is enabled.
  await page.locator('form').first().waitFor({ state: 'visible' })
  await page
    .locator('input#login-email, input#register-email, form input')
    .first()
    .waitFor({
      state: 'visible',
    })
  // One animation frame after visibility is usually enough for hydration in CI.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))))
}

/** Sign in with the default test credentials. */
export async function signIn(page: Page, email = TEST_EMAIL, password = TEST_PASSWORD) {
  await page.goto('/login')
  await waitForClientForm(page)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: /sign in/i }).click()
  // Prefer dashboard; also accept other authenticated landings.
  await page.waitForURL(/\/(dashboard|properties|home|inbox)/, { timeout: 20_000 })
}

/** Register a new account with a unique email. Returns the email used. */
export async function registerAccount(
  page: Page,
  email: string,
  password = 'Password123!',
) {
  await page.goto('/register')
  // Registration may redirect to /login when identity.register is off.
  await page.waitForLoadState('domcontentloaded')
  if (page.url().includes('/login')) {
    throw new Error(
      'Registration is capability-gated off (redirected to /login). ' +
        'Set BETA_E2E_GLOBAL_CAPABILITIES=identity.register,organization.create for e2e.',
    )
  }
  await waitForClientForm(page)
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
