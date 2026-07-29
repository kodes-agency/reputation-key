// E2E: Navigation between authenticated manager surfaces (BQR-5.2, hardened
// BQC-6.7). Single-property orgs redirect /dashboard → property deep-dive
// (product behavior).
//
// Posture note: the People surface renders in the beta posture — the F-PEOPLE
// fix (BQC-6.7) degrades the dark portals query instead of sinking the whole
// loader, so the Staff/Teams/Directory tabs are the honest expectation.

import { test, expect } from './helpers/error-detection'
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
    // The enabled People surface renders all three tabs even with portal.read
    // dark (F-PEOPLE degradation).
    await expect(page.getByRole('tab', { name: /staff/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /teams/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /directory/i })).toBeVisible()
  })
})
