// E2E: Team management within a property (People → Teams tab).
// Uses seeded property (BQR-5.2) — no UI property create path.
// Teams list UI supports create + delete (no inline edit on list row).

import { test, expect } from '@playwright/test'
import { signIn } from './helpers/auth'
import { requireE2eSeedState } from './helpers/seed-state'

test.describe('Team Management', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('create and delete a team within a property', async ({ page }) => {
    const seed = requireE2eSeedState()
    await page.goto(`/properties/${seed.propertyId}/people`)
    await page.getByRole('tab', { name: /teams/i }).click()

    const teamName = `Front Desk ${Date.now()}`
    await page.getByRole('button', { name: /create team/i }).click()
    await page.getByLabel('Team name').fill(teamName)
    await page.getByRole('button', { name: /^create team$/i }).click()
    await expect(page.getByText(teamName)).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: `Delete team ${teamName}` }).click()
    await page.getByRole('button', { name: /delete team/i }).click()
    await expect(page.getByText(teamName)).not.toBeVisible({ timeout: 15_000 })
  })
})
