// E2E: Staff assignment on property People surface (BQR-5.2, hardened BQC-6.7).
// Uses seeded property. Assigning requires at least one other org member —
// with only the seed admin present, assert the Staff tab chrome loads.
//
// Posture note: portal.read is dark in the beta posture, so the F-PEOPLE
// degradation is the honest expectation here — the Staff/Teams/Directory
// surface renders, and the Assign Staff dialog explains that portal-bound
// assignment is unavailable (assignments require a portal row).

import { test, expect } from './helpers/error-detection'
import { signIn } from './helpers/auth'
import { waitForHydration, clickWhenReady } from './helpers/interaction'
import { requireE2eSeedState } from './helpers/seed-state'

test.describe('Staff Assignment', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('property people staff tab loads with the dark-portals degradation', async ({
    page,
  }) => {
    const seed = requireE2eSeedState()
    await page.goto(`/properties/${seed.propertyId}/people`)
    await waitForHydration(page)

    // The enabled surface renders all three tabs (F-PEOPLE fix — the dark
    // portals query no longer sinks the loader).
    const staffTab = page.getByRole('tab', { name: /staff/i })
    await expect(staffTab).toBeVisible()
    await expect(page.getByRole('tab', { name: /teams/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /directory/i })).toBeVisible()
    await staffTab.click()

    // Staff chrome loads: the assign action exists; the list shows either
    // assignments or the empty state.
    await clickWhenReady(page.getByRole('button', { name: /assign staff/i }))
    await expect(page.getByText(/portals are not available in the beta/i)).toBeVisible()
  })
})
