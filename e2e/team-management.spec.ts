// E2E: Team management within a property

import { test, expect } from '@playwright/test'
import { signIn } from './helpers/auth'

test.describe('Team Management', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('create a team within a property', async ({ page }) => {
    // Navigate to properties and create one
    await page.goto('/properties')
    await page.getByRole('link', { name: /add property/i }).click()
    const propertyName = `E2E Team ${Date.now()}`
    await page.getByLabel('Name').fill(propertyName)
    await page.getByLabel(/slug/i).fill(`e2e-team-${Date.now()}`)
    await page.getByRole('button', { name: /create property/i }).click()
    await page.waitForURL('/properties')

    // Open the property
    await page.getByText(propertyName).click()

    // Navigate to Teams tab
    await page.getByRole('link', { name: /teams/i }).click()
    await expect(page.getByRole('heading', { name: /teams/i })).toBeVisible()

    // Create a team
    const teamName = `Front Desk ${Date.now()}`
    await page.getByRole('button', { name: /create team/i }).click()
    await page.getByPlaceholder('Front Desk').fill(teamName)
    await page.getByRole('button', { name: /create team/i }).click()

    // Team should appear in list
    await expect(page.getByText(teamName)).toBeVisible()

    // ── Cleanup ─────────────────────────────────────────────────
    await page.goto('/properties')
    await page.getByText(propertyName).click()
    page.on('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: /delete property/i }).click()
    await page.waitForURL('/properties')
  })

  test('edit and delete a team', async ({ page }) => {
    // Navigate to properties and create one
    await page.goto('/properties')
    await page.getByRole('link', { name: /add property/i }).click()
    const propertyName = `E2E Team Edit ${Date.now()}`
    await page.getByLabel('Name').fill(propertyName)
    await page.getByLabel(/slug/i).fill(`e2e-team-edit-${Date.now()}`)
    await page.getByRole('button', { name: /create property/i }).click()
    await page.waitForURL('/properties')

    // Open the property and go to Teams
    await page.getByText(propertyName).click()
    await page.getByRole('link', { name: /teams/i }).click()

    // Create a team
    const teamName = `Housekeeping ${Date.now()}`
    await page.getByRole('button', { name: /create team/i }).click()
    await page.getByPlaceholder('Front Desk').fill(teamName)
    await page.getByRole('button', { name: /save team/i }).click()
    await expect(page.getByText(teamName)).toBeVisible()

    // Edit the team
    const updatedName = `${teamName} Updated`
    await page.getByRole('button', { name: /edit/i }).first().click()
    await page.getByPlaceholder('Front Desk').fill(updatedName)
    await page.getByRole('button', { name: /save/i }).click()
    await expect(page.getByText(updatedName)).toBeVisible()

    // Delete the team
    page.on('dialog', (dialog) => dialog.accept())
    await page
      .getByRole('button', { name: /remove/i })
      .first()
      .click()
    await expect(page.getByText(updatedName)).not.toBeVisible()

    // ── Cleanup ─────────────────────────────────────────────────
    await page.goto('/properties')
    await page.getByText(propertyName).click()
    page.on('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: /delete property/i }).click()
    await page.waitForURL('/properties')
  })
})
