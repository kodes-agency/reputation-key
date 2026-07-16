// E2E: Property detail page — open seeded property (BQR-5.1)
// Edit/delete UI may still drift; critical path only asserts detail opens.

import { test, expect } from '@playwright/test'
import { signIn } from './helpers/auth'
import { openSeededProperty, SEEDED_PROPERTY_NAME } from './helpers/property'

test.describe('Property Detail', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('view seeded property details', async ({ page }) => {
    await openSeededProperty(page)
    await expect(page.getByText(SEEDED_PROPERTY_NAME).first()).toBeVisible()
  })
})
