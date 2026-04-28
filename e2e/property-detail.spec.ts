// E2E: Property detail page — view and edit

import { test, expect } from '@playwright/test'
import { signIn } from './helpers/auth'

test.describe('Property Detail', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('view property details and edit', async ({ page }) => {
    // Navigate to properties
    await page.goto('/properties')
    await expect(page.getByRole('heading', { name: /properties/i })).toBeVisible()

    // Create a property first
    await page.getByRole('link', { name: /add property/i }).click()
    const propertyName = `E2E Detail ${Date.now()}`
    await page.getByLabel('Name').fill(propertyName)
    await page.getByLabel(/slug/i).fill(`e2e-detail-${Date.now()}`)
    await page.getByRole('button', { name: /create property/i }).click()
    await page.waitForURL('/properties')

    // Click into the property
    await page.getByText(propertyName).click()

    // Should see property details
    await expect(page.getByText(/property details/i)).toBeVisible()
    await expect(page.getByRole('heading', { name: propertyName })).toBeVisible()

    // Edit the property
    await page.getByRole('button', { name: /edit/i }).click()
    const updatedName = `${propertyName} Edited`
    await page.getByLabel('Name').fill(updatedName)
    await page.getByRole('button', { name: /save changes/i }).click()

    // Should show updated name
    await expect(page.getByRole('heading', { name: updatedName })).toBeVisible()

    // ── Cleanup ─────────────────────────────────────────────────
    page.on('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: /delete property/i }).click()
    await page.waitForURL('/properties')
  })
})
