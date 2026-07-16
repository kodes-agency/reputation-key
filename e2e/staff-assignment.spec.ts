// E2E: Staff assignment on property People surface (BQR-5.2).
// Uses seeded property. Assigning requires at least one other org member —
// with only the seed admin present, assert the Staff tab chrome loads.

import { test, expect } from '@playwright/test'
import { signIn } from './helpers/auth'
import { requireE2eSeedState } from './helpers/seed-state'

test.describe('Staff Assignment', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('property people staff tab loads', async ({ page }) => {
    const seed = requireE2eSeedState()
    await page.goto(`/properties/${seed.propertyId}/people`)
    // Default tab may be Staff or Directory depending on product defaults.
    const staffTab = page.getByRole('tab', { name: /staff/i })
    if (await staffTab.isVisible().catch(() => false)) {
      await staffTab.click()
    }
    await expect(page.getByRole('tab', { name: /teams/i })).toBeVisible()
    // No second member to assign in seed-only orgs — chrome visibility is the gate.
    await expect(page.getByText(/staff|assign|no staff|directory/i).first()).toBeVisible({
      timeout: 15_000,
    })
  })
})
