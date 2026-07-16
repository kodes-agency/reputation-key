// E2E: Navigation between authenticated manager surfaces (BQR-5.2).
// Single-property orgs redirect /dashboard → property deep-dive (product behavior).

import { test, expect } from '@playwright/test'
import { signIn } from './helpers/auth'
import { openSeededProperty, SEEDED_PROPERTY_NAME } from './helpers/property'
import { requireE2eSeedState } from './helpers/seed-state'

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('navigate properties, inbox, and members settings', async ({ page }) => {
    await page.goto('/properties')
    await expect(page.getByRole('heading', { name: /^properties$/i })).toBeVisible()

    await page.goto('/inbox')
    await expect(page).toHaveURL(/\/inbox/)

    await page.goto('/settings/members')
    await expect(page.getByRole('heading', { name: /^members$/i }).first()).toBeVisible()
  })

  test('property detail tabs navigate correctly', async ({ page }) => {
    const seed = requireE2eSeedState()
    await openSeededProperty(page)
    await expect(page.getByText(SEEDED_PROPERTY_NAME).first()).toBeVisible()

    // Manager property nav: Reviews + People (not legacy Teams/Staff top-level tabs).
    await page.goto(`/properties/${seed.propertyId}/reviews`)
    await expect(page).toHaveURL(new RegExp(`/properties/${seed.propertyId}/reviews`))

    await page.goto(`/properties/${seed.propertyId}/people`)
    await expect(page).toHaveURL(new RegExp(`/properties/${seed.propertyId}/people`))
    await expect(page.getByRole('tab', { name: /teams/i })).toBeVisible()
  })
})
