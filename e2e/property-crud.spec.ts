// E2E: Property CRUD flow

import { test, expect } from '@playwright/test'
import { signIn } from './helpers/auth'
import { createProperty } from './helpers/property'

test.describe('Property CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('create, list, edit, and delete a property', async ({ page }) => {
    // ── Create a property ───────────────────────────────────────
    const propertyName = await createProperty(page, 'E2E Hotel')
    await expect(page.getByText(propertyName)).toBeVisible()

    // ── Edit the property ───────────────────────────────────────
    await page.getByText(propertyName).click()
    await page.getByRole('button', { name: /edit/i }).click()
    const updatedName = `${propertyName} Updated`
    await page.getByLabel('Name').fill(updatedName)
    await page.getByRole('button', { name: /save changes/i }).click()
    await expect(page.getByRole('heading', { name: updatedName })).toBeVisible()

    // ── Delete the property ─────────────────────────────────────
    page.on('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: /delete property/i }).click()
    await page.waitForURL('/properties')
    await expect(page.getByText(updatedName)).not.toBeVisible()
  })
})
