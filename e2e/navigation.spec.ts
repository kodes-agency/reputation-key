// E2E: Navigation between authenticated manager surfaces.
// The beta-local seed exposes the promoted People, Portal, and Goal
// surfaces only for P1 while preserving ordinary property navigation.
//
// The three-route hop this file used to open with was deleted: each of its
// assertions is made — identically, and by name — in
// critical/auth-and-shell.spec.ts ('properties list shows seeded property',
// 'inbox triage surface loads for manager', 'settings members page loads').
// It cost a fourth sign-in to re-assert three locators the critical project
// already gates. What remains is the part nothing else covers: the promoted P1
// People surface rendering its current management tabs together.

import { test, expect } from './helpers/error-detection'
import { signIn } from './helpers/auth'
import { openSeededProperty, SEEDED_PROPERTY_NAME } from './helpers/property'
import { requireE2eSeedState } from './helpers/seed-state'

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
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
    // Team is quarantined; the People surface exposes Staff and Directory only.
    await expect(page.getByRole('tab', { name: /staff/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /directory/i })).toBeVisible()
  })
})
