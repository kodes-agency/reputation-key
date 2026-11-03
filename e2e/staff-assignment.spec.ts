// E2E: the Staff page on P1 is one list of people with a login (ADR 0076, R11).
// The beta-local seed holds a durable Staff participation with no login. Reporting
// still attributes to it, but it is not a person a manager can manage here.

import { test, expect } from './helpers/error-detection'
import { signIn } from './helpers/auth'
import { waitForHydration } from './helpers/interaction'
import { requireE2eSeedState } from './helpers/seed-state'

test.describe('Staff page', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('P1 is one list that leaves out a profile with no login', async ({ page }) => {
    const seed = requireE2eSeedState()
    await page.goto(`/properties/${seed.p1PropertyId}/people`)
    await waitForHydration(page)

    // One Staff list: no Staff / Directory tabs. Every member lives on
    // Settings > Members, which has the roles and properties.
    await expect(page.getByRole('heading', { name: 'Staff', level: 1 })).toBeVisible()
    await expect(page.getByRole('tab')).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'People views' })).toHaveCount(0)

    await expect(page.getByRole('button', { name: 'Add staff' }).first()).toBeVisible()
    await expect(page.getByText(seed.staffName, { exact: true })).toHaveCount(0)
  })
})
