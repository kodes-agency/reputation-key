// The guest page a denied portal address shows (board G12). Every denial reason
// lands on the same page, so specs share one assertion for it.

import { expect, type Page } from '@playwright/test'

/** Fails unless the page is the neutral unavailable page, in English and Bulgarian. */
export async function expectPortalUnavailable(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', { name: 'This page isn’t available right now.' }),
  ).toBeVisible()
  await expect(page.getByText('Please check back later.')).toBeVisible()
  await expect(page.getByText('Тази страница не е достъпна в момента.')).toBeVisible()
}
