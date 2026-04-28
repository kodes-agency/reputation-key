// E2E: Staff assignment to a property

import { test, expect } from '@playwright/test'
import { signIn } from './helpers/auth'

test.describe('Staff Assignment', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('assign a staff member to a property', async ({ page }) => {
    // Navigate to properties and create one
    await page.goto('/properties')
    await page.getByRole('link', { name: /add property/i }).click()
    const propertyName = `E2E Staff ${Date.now()}`
    await page.getByLabel('Name').fill(propertyName)
    await page.getByLabel(/slug/i).fill(`e2e-staff-${Date.now()}`)
    await page.getByRole('button', { name: /create property/i }).click()
    await page.waitForURL('/properties')

    // Open the property and go to Staff tab
    await page.getByText(propertyName).click()
    await page.getByRole('link', { name: /staff/i }).click()
    await expect(page.getByRole('heading', { name: /staff/i })).toBeVisible()

    // Assign staff (the current user should be available as an org member)
    await page
      .getByRole('combobox')
      .filter({ hasText: /select a staff member/i })
      .click()
    await page.getByRole('option').first().click()

    // Submit assignment
    await page.getByRole('button', { name: /assign staff/i }).click()

    // Assignment should appear in list — look for the Unassign button
    await expect(page.getByRole('button', { name: /unassign/i })).toBeVisible()

    // ── Cleanup ─────────────────────────────────────────────────
    await page.goto('/properties')
    await page.getByText(propertyName).click()
    page.on('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: /delete property/i }).click()
    await page.waitForURL('/properties')
  })
})
