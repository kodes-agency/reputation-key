// E2E: Team management within the promoted P1 People surface.
// Uses the deterministic beta-local seed and proves manager create/archive
// mutations survive reload.

import { test, expect } from './helpers/error-detection'
import { signIn } from './helpers/auth'
import { waitForHydration, clickWhenReady } from './helpers/interaction'
import { requireE2eSeedState } from './helpers/seed-state'

test.describe('Team Management', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('create and archive a team within a property', async ({ page }) => {
    const seed = requireE2eSeedState()
    await page.goto(`/properties/${seed.propertyId}/people`)
    await waitForHydration(page)
    await clickWhenReady(page.getByRole('tab', { name: /teams/i }))

    const teamName = `Front Desk ${Date.now()}`
    await clickWhenReady(page.getByRole('button', { name: /create team/i }))
    await page.getByLabel('Team name').fill(teamName)
    await clickWhenReady(page.getByRole('button', { name: /^create team$/i }))
    // exact: true — the delete dialog's title also contains the team name.
    await expect(page.getByText(teamName, { exact: true })).toBeVisible({
      timeout: 15_000,
    })
    await page.reload()
    await expect(page.getByText(teamName, { exact: true })).toBeVisible({
      timeout: 15_000,
    })

    await clickWhenReady(page.getByRole('button', { name: `Archive team ${teamName}` }))
    await clickWhenReady(page.getByRole('button', { name: /archive team/i }))
    await expect(page.getByText(teamName, { exact: true })).not.toBeVisible({
      timeout: 15_000,
    })
  })
})
