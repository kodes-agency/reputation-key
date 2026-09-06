// E2E auth helpers — shared login/registration utilities

import { expect, type Page } from '@playwright/test'
import { clickWhenReady, waitForHydration } from './interaction'
import { readE2eSeedState } from './seed-state'

// Credentials come from the state the seed itself wrote, not from env with a
// hardcoded fallback. `pnpm e2e:stack:up` GENERATES E2E_TEST_PASSWORD into
// .local-stack/e2e/stack.env and passes it to the seed container; Playwright runs on
// the host where that variable is unset, so `?? 'password123'` silently disagreed
// with the hash the seed had written and every sign-in returned 401
// INVALID_EMAIL_OR_PASSWORD. Reading the seed state removes the second source of
// truth. Env still wins when set, for a hand-seeded database.
const seedState = readE2eSeedState()
export const TEST_EMAIL =
  process.env.E2E_TEST_EMAIL ?? seedState?.email ?? 'test@example.com'
export const TEST_PASSWORD =
  process.env.E2E_TEST_PASSWORD ?? seedState?.password ?? 'password123'

/**
 * Sign in via better-auth HTTP API (Set-Cookie on the browser context), then
 * set the first organization active. Server-fn UI login historically left
 * sessions without cookies / without active org, which made e2e hang ~18m.
 *
 * `origin` overrides the CSRF origin/referer headers for non-default servers
 * (BQC-6.5's locked server on :3001); relative request URLs already follow
 * the Playwright context baseURL.
 */
const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

function apiHeaders(extra: Record<string, string> = {}, origin: string = ORIGIN) {
  // better-auth CSRF/origin checks require Origin on mutating org routes
  return {
    'content-type': 'application/json',
    origin,
    referer: `${origin}/`,
    ...extra,
  }
}

export async function signIn(
  page: Page,
  email = TEST_EMAIL,
  password = TEST_PASSWORD,
  origin?: string,
  landingPath?: string,
) {
  const response = await page.request.post('/api/auth/sign-in/email', {
    data: { email, password },
    headers: apiHeaders({}, origin),
  })
  if (!response.ok()) {
    const body = await response.text()
    throw new Error(
      `E2E sign-in API failed (${response.status()}): ${body.slice(0, 300)}. ` +
        `Ensure scripts/seed-e2e-user.ts ran and credentials match E2E_TEST_*.`,
    )
  }

  const orgsRes = await page.request.get('/api/auth/organization/list', {
    headers: apiHeaders({}, origin),
  })
  if (!orgsRes.ok()) {
    const body = await orgsRes.text()
    throw new Error(
      `E2E organization list failed (${orgsRes.status()}): ${body.slice(0, 300)}`,
    )
  }
  const orgs = (await orgsRes.json()) as unknown
  const list = Array.isArray(orgs) ? orgs : []
  const first = list[0] as { id?: string } | undefined
  if (!first?.id) {
    throw new Error('E2E seeded user has no organization membership')
  }
  const active = await page.request.post('/api/auth/organization/set-active', {
    data: { organizationId: first.id },
    headers: apiHeaders({}, origin),
  })
  if (!active.ok()) {
    const body = await active.text()
    throw new Error(
      `E2E set-active org failed (${active.status()}): ${body.slice(0, 300)}`,
    )
  }

  // Wait for the clean authenticated landing (or the explicit unavailable
  // state when this helper is used with a non-interactive beta role).
  await page.goto(landingPath ?? '/dashboard')
  await page.waitForURL(/\/(dashboard|properties|inbox|settings|unavailable)/, {
    timeout: 20_000,
  })
  // Route redirects can resolve before their server-function loaders finish.
  // Returning earlier makes the caller's next navigation abort those requests
  // and surfaces a real browser `Failed to fetch` console error.
  await page.waitForLoadState('networkidle')
}

/** Create a beta manager account from one exact invitation. */
export async function registerInvitedAccount(
  page: Page,
  invitationId: string,
  email: string,
  password = 'Password123!',
) {
  await page.goto(`/accept-invitation?id=${encodeURIComponent(invitationId)}`)
  await page.waitForLoadState('domcontentloaded')
  if (!page.url().includes('/join')) {
    throw new Error(
      `Invitation onboarding did not reach /join (current URL: ${page.url()}).`,
    )
  }
  // BQC-6.7: wait out the pre-hydration window BEFORE touching the controlled
  // inputs (hydration would reset them / a pre-hydration submit click would
  // native-submit the form and reload the document).
  await waitForHydration(page)
  await page.locator('form').first().waitFor({ state: 'visible' })
  await page.getByLabel('Full name').fill('E2E Test User')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm password').fill(password)
  await clickWhenReady(page.getByRole('button', { name: /create account/i }))

  // Success renders on /join — no implicit session or Organization switch.
  const success = page.getByText(/account created/i)
  const errorBanner = page.locator('[role="alert"]')
  // .first(): the failure banner's own copy can match /account created/i
  // ("Account created, but organization setup failed") — without it the .or()
  // locator resolves to 2 elements and strict mode masks the real error.
  await expect(success.or(errorBanner).first()).toBeVisible({ timeout: 20_000 })
  if (await errorBanner.isVisible().catch(() => false)) {
    const msg = (await errorBanner.innerText().catch(() => '')).trim()
    throw new Error(`Registration failed with UI error: ${msg || '(empty alert)'}`)
  }
  await expect(success).toBeVisible()
  return email
}
