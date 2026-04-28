// E2E: Navigation between authenticated pages

import { test, expect } from '@playwright/test'
import { signIn } from './helpers/auth'

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('navigate through dashboard, properties, and members', async ({ page }) => {
    // Dashboard
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible()

    // Properties
    await page.getByRole('link', { name: /properties/i }).click()
    await expect(page.getByRole('heading', { name: /properties/i })).toBeVisible()

    // Members (links to /settings/members)
    await page.getByRole('link', { name: /members/i }).click()
    await expect(page.getByRole('heading', { name: /members/i })).toBeVisible()

    // Org-level Staff page (navigate directly — no header link)
    await page.goto('/staff')
    await expect(page.getByRole('heading', { name: /staff/i })).toBeVisible()
  })

  test('property detail tabs navigate correctly', async ({ page }) => {
    // Create a property first
    await page.goto('/properties')
    await page.getByRole('link', { name: /add property/i }).click()
    const propertyName = `E2E Nav ${Date.now()}`
    const slug = `e2e-nav-${Date.now()}`
    await page.getByLabel('Name').fill(propertyName)
    await page.getByLabel(/slug/i).fill(slug)
    await page.getByRole('button', { name: /create property/i }).click()
    await page.waitForURL('/properties')

    // Open property
    await page.getByText(propertyName).click()

    // Overview tab (default)
    await expect(page.getByText(/property details/i)).toBeVisible()

    // Teams tab
    await page.getByRole('link', { name: /teams/i }).click()
    await expect(page.getByRole('heading', { name: /teams/i })).toBeVisible()

    // Staff tab
    await page.getByRole('link', { name: /staff/i }).click()
    await expect(page.getByRole('heading', { name: /staff/i })).toBeVisible()

    // ── Cleanup ─────────────────────────────────────────────────
    await page.goto('/properties')
    await page.getByText(propertyName).click()
    page.on('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: /delete property/i }).click()
    await page.waitForURL('/properties')
  })
})
