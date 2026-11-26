// E2E property helpers for the beta-local-1 P1 fixture.
// Manual UI create was removed; properties enter via governed server paths.

import { expect, type Page } from '@playwright/test'
import { requireE2eSeedState } from './seed-state'

const seed = requireE2eSeedState()
export const SEEDED_PROPERTY_NAME = seed.propertyName

/**
 * Open the seeded property detail page.
 * Prefers a deep-link from seed state (reliable) over list-row click
 * (client-side navigate on a div is hydration-sensitive under Playwright).
 */
export async function openSeededProperty(page: Page): Promise<string> {
  const seed = requireE2eSeedState()
  await page.goto(`/properties/${seed.propertyId}`)
  await expect(page).toHaveURL(new RegExp(`/properties/${seed.propertyId}`), {
    timeout: 20_000,
  })
  // The dashboard header names the property in its meta line and its breadcrumbs.
  await expect(page.getByText(seed.propertyName).first()).toBeVisible({
    timeout: 15_000,
  })
  return seed.propertyName
}
