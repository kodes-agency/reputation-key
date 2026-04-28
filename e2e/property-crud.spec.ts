// E2E: Property CRUD flow
// Phase 5 gate criteria: "user logs in, creates a property, sees it in the list,
// edits it, deletes it"
//
// Prerequisites: dev server running at BASE_URL with a test user account.

import { test, expect } from '@playwright/test'
import { signIn } from './helpers/auth'

test.describe('Property CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('create, list, edit, and delete a property', async ({ page }) => {
    // ── Navigate to properties ──────────────────────────────────
    await page.goto('/properties')
    await expect(page.getByRole('heading', { name: /properties/i })).toBeVisible()

    // ── Create a property ───────────────────────────────────────
    await page.getByRole('link', { name: /add property/i }).click()
    await expect(page.getByRole('heading', { name: /new property/i })).toBeVisible()

    const propertyName = `E2E Hotel ${Date.now()}`
    const slug = `e2e-hotel-${Date.now()}`
    await page.getByLabel('Name').fill(propertyName)
    // Slug auto-generates from name, but we override for predictability
    await page.getByLabel(/slug/i).fill(slug)

    // Submit the form
    await page.getByRole('button', { name: /create property/i }).click()

    // Should redirect back to properties list
    await page.waitForURL('/properties')
    await expect(page.getByText(propertyName)).toBeVisible()

    // ── Edit the property ───────────────────────────────────────
    // Click the property in the list
    await page.getByText(propertyName).click()
    await expect(page.getByText(new RegExp(slug, 'i'))).toBeVisible()

    // Click Edit
    await page.getByRole('button', { name: /edit/i }).click()

    // Update the name
    const updatedName = `${propertyName} Updated`
    await page.getByLabel('Name').fill(updatedName)
    await page.getByRole('button', { name: /save changes/i }).click()

    // Should exit edit mode and show updated name
    await expect(page.getByRole('heading', { name: updatedName })).toBeVisible()

    // ── Delete the property ─────────────────────────────────────
    // Accept the confirmation dialog
    page.on('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: /delete property/i }).click()

    // Should redirect back to properties list
    await page.waitForURL('/properties')

    // Property should no longer appear
    await expect(page.getByText(updatedName)).not.toBeVisible()
  })
})
