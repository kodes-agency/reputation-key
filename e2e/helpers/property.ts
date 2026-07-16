// E2E property helpers — use seeded property (BQR-5.1).
// Manual UI create was removed; properties enter via Google import.
// CI seeds `e2e-seed-property` via scripts/seed-e2e-user.ts.

import { expect, type Page } from '@playwright/test'

export const SEEDED_PROPERTY_NAME = process.env.E2E_TEST_PROPERTY ?? 'E2E Seed Property'
export const SEEDED_PROPERTY_SLUG =
  process.env.E2E_TEST_PROPERTY_SLUG ?? 'e2e-seed-property'

/**
 * Open the seeded property from the properties list.
 * Prefer this over createProperty — there is no /properties/new UI path.
 */
export async function openSeededProperty(page: Page): Promise<string> {
  await page.goto('/properties')
  await expect(page.getByRole('heading', { name: /properties/i })).toBeVisible()
  const name = SEEDED_PROPERTY_NAME
  await page.getByText(name).click()
  await expect(page).toHaveURL(/\/properties\//)
  return name
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
  await page.getByText(propertyName).click()
  page.on('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: /delete property/i }).click()
  await page.waitForURL('/properties')
}

/**
 * Navigate into a property from the properties list.
 */
export async function openProperty(page: Page, propertyName: string): Promise<void> {
  await page.goto('/properties')
  await page.getByText(propertyName).click()
  await expect(page).toHaveURL(/\/properties\//)
}
