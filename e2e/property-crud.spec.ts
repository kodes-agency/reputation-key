// E2E: Property list + detail using seeded property (BQR-5.1)
// UI create path was removed; properties enter via Google import.

import { test, expect } from '@playwright/test'
import { signIn } from './helpers/auth'
import { openSeededProperty, SEEDED_PROPERTY_NAME } from './helpers/property'

test.describe('Property list and detail', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('list shows seeded property and opens detail', async ({ page }) => {
    await page.goto('/properties')
    await expect(page.getByRole('heading', { name: /^properties$/i })).toBeVisible()
    await expect(page.getByText(SEEDED_PROPERTY_NAME)).toBeVisible()

    await openSeededProperty(page)
    await expect(page).toHaveURL(/\/properties\/[a-f0-9-]+/)
  })
})
