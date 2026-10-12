// E2E auth helpers — shared login/registration utilities

import { expect, type Page } from '@playwright/test'
import { serverFnUrl } from './fixtures'
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
 * make the account's Organization active through the app-owned ensureActiveOrg
 * server function, which is what the login page calls after signing in.
 * Server-fn UI login historically left sessions without cookies / without
 * active org, which made e2e hang ~18m.
 *
 * The provider's own organization routes (`/organization/list`,
 * `/organization/set-active`) used to do the second step. They are no longer
 * served: /api/auth/* is an allow list (src/routes/api/auth/-provider-routes.ts).
 *
 * `origin` overrides the CSRF origin/referer headers for non-default servers
 * (BQC-6.5's locked server on :3001); relative request URLs already follow
 * the Playwright context baseURL.
 */
const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

/** What a same-origin browser request carries; both CSRF checks read these. */
function sameOriginHeaders(origin: string = ORIGIN) {
  return { origin, referer: `${origin}/` }
}

function apiHeaders(extra: Record<string, string> = {}, origin: string = ORIGIN) {
  // better-auth CSRF/origin checks require Origin on its mutating routes
  return {
    'content-type': 'application/json',
    ...sameOriginHeaders(origin),
    ...extra,
  }
}

/**
 * Call the app-owned ensureActiveOrg for the session in this browser context.
 * It takes no input, so the request has no body (and no JSON content type,
 * which the server-function handler would try to parse). Server functions
 * accept only same-origin requests (src/start.ts); a browser states that with
 * Fetch Metadata, and this client states the same thing.
 */
async function ensureActiveOrganization(page: Page, origin?: string): Promise<void> {
  const ensured = await page.request.post(
    serverFnUrl('src/shared/auth/auth.functions.ts', 'ensureActiveOrg'),
    {
      headers: {
        ...sameOriginHeaders(origin),
        'sec-fetch-site': 'same-origin',
        'x-tsr-serverFn': 'true',
      },
    },
  )
  if (!ensured.ok()) {
    const body = await ensured.text()
    throw new Error(
      `E2E ensureActiveOrg failed (${ensured.status()}): ${body.slice(0, 300)}`,
    )
  }

  // ensureActiveOrg answers nothing and leaves an account alone unless it has
  // exactly one Organization, so read the outcome from the session itself.
  const sessionRes = await page.request.get('/api/auth/get-session', {
    headers: sameOriginHeaders(origin),
  })
  if (!sessionRes.ok()) {
    const body = await sessionRes.text()
    throw new Error(
      `E2E session read failed (${sessionRes.status()}): ${body.slice(0, 300)}`,
    )
  }
  const current = (await sessionRes.json()) as {
    session?: { activeOrganizationId?: string | null }
  } | null
  if (!current?.session?.activeOrganizationId) {
    throw new Error(
      'E2E signed-in user has no active Organization: it needs exactly one organization membership',
    )
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

  await ensureActiveOrganization(page, origin)

  // Wait for the clean authenticated landing (or the explicit unavailable
  // state when this helper is used with a non-interactive beta role).
  await page.goto(landingPath ?? '/properties')
  await page.waitForURL(/\/(dashboard|properties|inbox|settings|unavailable)/, {
    timeout: 20_000,
  })
  // Route redirects can resolve before their server-function loaders finish.
  // Returning earlier makes the caller's next navigation abort those requests
  // and surfaces a real browser `Failed to fetch` console error.
  await page.waitForLoadState('networkidle')
}

/**
 * Create a beta manager account from one exact invitation. Consuming the
 * invitation verifies the address and signs the member in (ADR 0062), so a
 * successful registration lands in the app rather than on a "sign in" card.
 * The join form shows the invited address locked; `email` must match it.
 */
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
  // The invitation decided the address: the field arrives filled and locked,
  // so the journey checks it instead of typing it.
  const emailField = page.getByLabel('Email')
  await expect(emailField).toHaveValue(email)
  await expect(emailField).toHaveAttribute('readonly', '')
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm password').fill(password)
  await clickWhenReady(page.getByRole('button', { name: /create account/i }))

  // Success signs in and navigates into the app. A refusal renders the form's
  // alert on /join; a sign-in that failed after the account was created shows
  // the "sign in to your account" card, which is a failure here.
  const errorBanner = page.locator('[role="alert"]')
  const signInCard = page.getByRole('link', { name: /sign in to your account/i })
  await expect
    .poll(
      async () => {
        if (!new URL(page.url()).pathname.startsWith('/join')) return 'app'
        if (await errorBanner.isVisible().catch(() => false)) return 'error'
        if (await signInCard.isVisible().catch(() => false)) return 'signed-out'
        return 'pending'
      },
      { timeout: 20_000 },
    )
    .not.toBe('pending')
  if (await errorBanner.isVisible().catch(() => false)) {
    const msg = (await errorBanner.innerText().catch(() => '')).trim()
    throw new Error(`Registration failed with UI error: ${msg || '(empty alert)'}`)
  }
  if (new URL(page.url()).pathname.startsWith('/join')) {
    throw new Error('Registration created the account but did not sign the member in.')
  }
  await page.waitForURL(/\/(dashboard|properties|inbox|settings)/, { timeout: 20_000 })
  // Route redirects can resolve before their server-function loaders finish;
  // settle them so the caller's next navigation does not abort a fetch.
  await page.waitForLoadState('networkidle')
  return email
}
