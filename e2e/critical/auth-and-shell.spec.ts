// BQR-5.1 critical path — hard CI gate.
// Auth bootstrap + authenticated shell for beta-enabled surfaces.
//
// Scope notes:
// - Self-service registration is a non-core capability (OFF in real beta).
//   Critical only asserts the capability surface opens under
//   BETA_E2E_GLOBAL_CAPABILITIES. Full register→sign-in lives in residual
//   e2e/auth.spec.ts (soft gate until BQR-5.2).
// - Property detail uses seed-state deep-link (product has no /properties/new).

import { test, expect } from '@playwright/test'
import { signIn } from '../helpers/auth'
import { openSeededProperty, SEEDED_PROPERTY_NAME } from '../helpers/property'

test.describe('Critical: authentication', () => {
  test('sign in with seeded credentials reaches authenticated area', async ({ page }) => {
    await signIn(page)
    await expect(page).toHaveURL(/\/(dashboard|properties|home|inbox)/)
  })

  test('registration form is reachable when e2e capabilities are on', async ({
    page,
  }) => {
    await page.goto('/register')
    await page.waitForLoadState('domcontentloaded')
    // Capability off → redirect to /login. Capability on → create-account form.
    // AuthCard titles are divs (not heading roles).
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.getByText(/create your account/i)).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Organization name')).toBeVisible()
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible()
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
})
