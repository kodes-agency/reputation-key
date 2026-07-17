// E2E auth helpers — shared login/registration utilities

import { expect, type Page } from '@playwright/test'

export const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? 'test@example.com'
export const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD ?? 'password123'

/**
 * Sign in via better-auth HTTP API (Set-Cookie on the browser context), then
 * set the first organization active. Server-fn UI login historically left
 * sessions without cookies / without active org, which made e2e hang ~18m.
 */
const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

function apiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  // better-auth CSRF/origin checks require Origin on mutating org routes
  return {
    'content-type': 'application/json',
    origin: ORIGIN,
    referer: `${ORIGIN}/`,
    ...extra,
  }
}

export async function signIn(page: Page, email = TEST_EMAIL, password = TEST_PASSWORD) {
  const response = await page.request.post('/api/auth/sign-in/email', {
    data: { email, password },
    headers: apiHeaders(),
  })
  if (!response.ok()) {
    const body = await response.text()
    throw new Error(
      `E2E sign-in API failed (${response.status()}): ${body.slice(0, 300)}. ` +
        `Ensure scripts/seed-e2e-user.ts ran and credentials match E2E_TEST_*.`,
    )
  }

  const orgsRes = await page.request.get('/api/auth/organization/list', {
    headers: apiHeaders(),
  })
  if (orgsRes.ok()) {
    const orgs = (await orgsRes.json()) as unknown
    const list = Array.isArray(orgs) ? orgs : []
    const first = list[0] as { id?: string } | undefined
    if (first?.id) {
      const active = await page.request.post('/api/auth/organization/set-active', {
        data: { organizationId: first.id },
        headers: apiHeaders(),
      })
      if (!active.ok()) {
        const body = await active.text()
        throw new Error(
          `E2E set-active org failed (${active.status()}): ${body.slice(0, 300)}`,
        )
      }
    }
  }

  await page.goto('/dashboard')
  await page.waitForURL(/\/(dashboard|properties|home|inbox)/, { timeout: 20_000 })
}

/** Register a new account with a unique email. Returns the email used. */
export async function registerAccount(
  page: Page,
  email: string,
  password = 'Password123!',
) {
  // Unique org name avoids better-auth slug collisions with the seeded "E2E Test Org".
  const orgSuffix = email.replace(/[^a-z0-9]/gi, '').slice(-10)
  const organizationName = `E2E Org ${orgSuffix}`

  await page.goto('/register')
  await page.waitForLoadState('domcontentloaded')
  if (page.url().includes('/login')) {
    throw new Error(
      'Registration is capability-gated off (redirected to /login). ' +
        'Set BETA_E2E_GLOBAL_CAPABILITIES=identity.register,organization.create for e2e. ' +
        'BQC-0.3: the override boots only with NODE_ENV=test or ' +
        'BETA_E2E_EXECUTION_IDENTITY=local-e2e set (test-only guard).',
    )
  }
  await page.locator('form').first().waitFor({ state: 'visible' })
  await page.getByLabel('Full name').fill('E2E Test User')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Organization name').fill(organizationName)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm password').fill(password)
  // Register form primary CTA is "Create account & organization" (not "Create account").
  await page.getByRole('button', { name: /create account/i }).click()

  // Success renders on /register — no redirect. AuthCard title is a div (not a heading role).
  const success = page.getByText(/account created/i)
  const errorBanner = page.locator('[role="alert"]')
  await expect(success.or(errorBanner)).toBeVisible({ timeout: 20_000 })
  if (await errorBanner.isVisible().catch(() => false)) {
    const msg = (await errorBanner.innerText().catch(() => '')).trim()
    throw new Error(`Registration failed with UI error: ${msg || '(empty alert)'}`)
  }
  await expect(success).toBeVisible()
  return email
}
