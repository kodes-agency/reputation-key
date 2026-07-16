// E2E property helpers — use seeded property (BQR-5.1).
// Manual UI create was removed; properties enter via Google import.
// CI seeds `e2e-seed-property` via scripts/seed-e2e-user.ts.

import { expect, type Page } from '@playwright/test'
import { requireE2eSeedState } from './seed-state'

export const SEEDED_PROPERTY_NAME = process.env.E2E_TEST_PROPERTY ?? 'E2E Seed Property'
export const SEEDED_PROPERTY_SLUG =
  process.env.E2E_TEST_PROPERTY_SLUG ?? 'e2e-seed-property'

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
  // Dashboard shell uses property name in description / breadcrumbs.
  await expect(page.getByText(seed.propertyName).first()).toBeVisible({
    timeout: 15_000,
  })
  return seed.propertyName
}

/**
 * @deprecated Prefer openSeededProperty — product no longer has UI property create.
 * Kept as alias so residual specs can migrate gradually.
 */
export async function createProperty(page: Page): Promise<string> {
  return openSeededProperty(page)
}

/**
 * Delete is intentionally not exercised for the seeded property in critical CI
 * (would break subsequent specs). Residual suites should create disposable data.
 */
export async function deleteProperty(page: Page, propertyName: string): Promise<void> {
  if (propertyName === SEEDED_PROPERTY_NAME) {
    // Do not delete the shared seed property in parallel CI workers.
    await page.goto('/properties')
    return
  }
  await page.goto('/properties')
  await page
    .locator('div.cursor-pointer')
    .filter({ hasText: propertyName })
    .first()
    .click()
  page.on('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: /delete property/i }).click()
  await page.waitForURL('/properties')
}

/**
 * Navigate into a property from the properties list (UI path).
 */
export async function openProperty(page: Page, propertyName: string): Promise<void> {
  await page.goto('/properties')
  await page
    .locator('div.cursor-pointer')
    .filter({ hasText: propertyName })
    .first()
    .click()
  await expect(page).toHaveURL(/\/properties\//)
}
