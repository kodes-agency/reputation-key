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

  // BQC-6.5: staff land on a clean authenticated surface — every
  // manager-gated route redirects them to /home, which is manager-shaped
  // today (its portals query requires staff_assignment.read, a permission
  // the built-in Staff role lacks — see slice report).
  await page.goto(landingPath ?? '/dashboard')
  await page.waitForURL(/\/(dashboard|properties|home|inbox|settings)/, {
    timeout: 20_000,
  })
  // Route redirects can resolve before their server-function loaders finish.
  // Returning earlier makes the caller's next navigation abort those requests
  // and surfaces a real browser `Failed to fetch` console error.
  await page.waitForLoadState('networkidle')
}

/** Register a new account with a unique email. Returns the email used. */
export async function registerAccount(
  page: Page,
  email: string,
  password = 'Password123!',
) {
  // Unique org name avoids better-auth slug collisions with the seeded "E2E Test Org".
  // Derive the suffix from the email's LOCAL PART (the unique segment) — the
  // alnum tail of the full address is always "examplecom", which collided on
  // slug for every registration after the first (latent helper bug).
  const orgSuffix = email
    .split('@')[0]
    .replace(/[^a-z0-9]/gi, '')
    .slice(-10)
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
  // BQC-6.7: wait out the pre-hydration window BEFORE touching the controlled
  // inputs (hydration would reset them / a pre-hydration submit click would
  // native-submit the form and reload the document).
  await waitForHydration(page)
  await page.locator('form').first().waitFor({ state: 'visible' })
  await page.getByLabel('Full name').fill('E2E Test User')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Organization name').fill(organizationName)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm password').fill(password)
  // Register form primary CTA is "Create account & organization" (not "Create account").
  await clickWhenReady(page.getByRole('button', { name: /create account/i }))

  // Success renders on /register — no redirect. AuthCard title is a div (not a heading role).
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
