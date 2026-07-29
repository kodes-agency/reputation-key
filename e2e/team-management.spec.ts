// E2E: Team management within a property (People → Teams tab).
// Uses seeded property (BQR-5.2) — no UI property create path.
// Teams list UI supports create + delete (no inline edit on list row).
//
// Posture note (BQC-6.7): team.use is deliberately ON for the e2e job
// (BETA_E2E_GLOBAL_CAPABILITIES on :3000) — the job's declared preview
// posture — so the positive create/delete flow is posture-honest here, not a
// dark positive. The dark side (team.use denied in the real beta posture) is
// pinned by e2e/critical/workflows + dark-promotion.spec.ts on the locked
// server (:3001).

import { test, expect } from './helpers/error-detection'
import { signIn } from './helpers/auth'
import { waitForHydration, clickWhenReady } from './helpers/interaction'
import { requireE2eSeedState } from './helpers/seed-state'

test.describe('Team Management', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('create and delete a team within a property', async ({ page }) => {
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

    await clickWhenReady(page.getByRole('button', { name: `Delete team ${teamName}` }))
    await clickWhenReady(page.getByRole('button', { name: /delete team/i }))
    await expect(page.getByText(teamName, { exact: true })).not.toBeVisible({
      timeout: 15_000,
    })
  })
})
