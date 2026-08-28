// BQR-5.1/5.2 critical path — hard CI gate.
// Auth bootstrap + authenticated shell for beta-enabled manager surfaces.
//
// Scope notes:
// - Self-service registration is permanently blocked in beta. The positive
//   invitation→registration→sign-in journey lives in e2e/auth.spec.ts.
// - Property People covers Staff Participants; quarantined Team has no beta UI.
// - Property/inbox/members use seed-state deep-links (no UI property create).

import { test, expect } from '../helpers/error-detection'
import { signIn } from '../helpers/auth'
import { openSeededProperty, SEEDED_PROPERTY_NAME } from '../helpers/property'
import { requireE2eSeedState } from '../helpers/seed-state'

/** InboxPageV2 chrome when empty or loading complete.
 * Multiple "Inbox" headings can exist (sidebar + list header) — use .first(). */
function inboxChrome(page: import('@playwright/test').Page) {
  return page
    .getByRole('heading', { name: /^open reviews$/i })
    .or(page.getByText(/no message selected/i))
    .or(page.getByText(/no inbox items/i))
    .or(page.getByText(/new reviews and feedback will appear here/i))
    .or(page.getByRole('button', { name: /retry/i }))
    .first()
}

test.describe('Critical: authentication', () => {
  test('sign in with seeded credentials reaches authenticated area', async ({ page }) => {
    await signIn(page)
    await expect(page).toHaveURL(/\/(dashboard|properties|home|inbox)/)
  })

  test('public registration stays closed and /join requires an invitation', async ({
    page,
  }) => {
    await page.goto('/register')
    await expect(page).toHaveURL(/\/login/)

    await page.goto('/join')
    await expect(page.getByText(/invitation required/i)).toBeVisible()
    await expect(page.locator('form')).toHaveCount(0)
  })
})

test.describe('Critical: properties shell', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('properties list shows seeded property', async ({ page }) => {
    await page.goto('/properties')
    await expect(page.getByRole('heading', { name: /^properties$/i })).toBeVisible()
    await expect(page.getByText(SEEDED_PROPERTY_NAME)).toBeVisible()
  })

  test('open seeded property detail', async ({ page }) => {
    await openSeededProperty(page)
    await expect(page).toHaveURL(/\/properties\/[a-f0-9-]+/i)
    await expect(page.getByText(SEEDED_PROPERTY_NAME).first()).toBeVisible()
  })

  test('property reviews route loads inbox chrome', async ({ page }) => {
    const seed = requireE2eSeedState()
    await page.goto(`/properties/${seed.propertyId}/reviews`)
    await expect(page).toHaveURL(new RegExp(`/properties/${seed.propertyId}/reviews`))
    // Property-scoped reviews reuses InboxPageV2 chrome (not property name text).
    await expect(inboxChrome(page)).toBeVisible({ timeout: 15_000 })
  })
})

test.describe('Critical: inbox and members shell', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('inbox triage surface loads for manager', async ({ page }) => {
    await page.goto('/inbox')
    await expect(page).toHaveURL(/\/inbox/)
    await expect(inboxChrome(page)).toBeVisible({ timeout: 15_000 })
  })

  test('settings members page loads', async ({ page }) => {
    await page.goto('/settings/members')
    await expect(page).toHaveURL(/\/settings\/members/)
    // PageHeader title + section h2 both say Members — use first match.
    await expect(page.getByRole('heading', { name: /^members$/i }).first()).toBeVisible({
      timeout: 15_000,
    })
  })
})
