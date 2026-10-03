// E2E: Staff participation and Portal responsibility on the promoted P1 People surface.
// The beta-local seed includes a durable Staff participation and primary Portal
// responsibility so the browser can prove the real management read model.

import { test, expect } from './helpers/error-detection'
import { signIn } from './helpers/auth'
import { waitForHydration, clickWhenReady } from './helpers/interaction'
import { requireE2eSeedState } from './helpers/seed-state'

test.describe('Staff Assignment', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('P1 staff tab renders the seeded participation and Portal responsibility', async ({
    page,
  }) => {
    const seed = requireE2eSeedState()
    await page.goto(`/properties/${seed.p1PropertyId}/people`)
    await waitForHydration(page)

    const views = page.getByRole('navigation', { name: 'People views' })
    const staffView = views.getByRole('link', { name: 'Staff' })
    await expect(staffView).toBeVisible()
    await expect(views.getByRole('link', { name: 'Directory' })).toBeVisible()
    await clickWhenReady(staffView)

    await expect(page.getByText(seed.staffName, { exact: true })).toBeVisible()
    await clickWhenReady(
      page.getByRole('button', {
        name: `Edit portal responsibilities for ${seed.staffName}`,
      }),
    )
    await expect(page.getByText('E2E Guest Portal P1', { exact: true })).toBeVisible()
    await expect(page.getByText(/portals are not available in the beta/i)).toHaveCount(0)
  })
})
