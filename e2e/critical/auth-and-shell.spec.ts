// BQR-5.1 critical path — hard CI gate.
// Auth bootstrap + authenticated shell for beta-enabled surfaces.

import { test, expect } from '@playwright/test'
import { signIn, registerAccount } from '../helpers/auth'
import { openSeededProperty, SEEDED_PROPERTY_NAME } from '../helpers/property'

test.describe('Critical: authentication', () => {
  test('sign in with seeded credentials reaches authenticated area', async ({ page }) => {
    await signIn(page)
    await expect(page).toHaveURL(/\/(dashboard|properties|home|inbox)/)
  })

  test('register a new account', async ({ page }) => {
    const uniqueEmail = `e2e-register-${crypto.randomUUID().slice(0, 8)}@example.com`
    await registerAccount(page, uniqueEmail)
    await expect(page.getByText(/account created/i)).toBeVisible()
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
    await expect(page).toHaveURL(/\/properties\/[a-f0-9-]+/)
  })
})
