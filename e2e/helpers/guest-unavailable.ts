// The guest page a denied portal address shows (board G12). Every denial reason
// lands on the same page, so specs share one assertion for it.

import { expect, type Page } from '@playwright/test'

/**
 * Fails unless the page is the neutral unavailable page, with the way to try
 * again. The browser here asks for English, so it is English alone: the fixed
 * Bulgarian line the page used to carry is gone, and another language shows
 * only when the visitor's browser asks for it.
 */
export async function expectPortalUnavailable(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', { name: 'This page isn’t available right now.' }),
  ).toBeVisible()
  await expect(page.getByText('Please check back later.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page.getByText('Тази страница не е достъпна в момента.')).toHaveCount(0)
}
