// E2E: Guest portal public flow.
// Requires a seeded public portal (/p/{org}/{portal}). BQR-5.2 does not seed
// portals (import/GBP path). Skip until BQR-6/7 seed fixtures add a portal.

import { test, expect } from '@playwright/test'

test('guest portal flow: visit, rate, feedback', async ({ page }) => {
  test.skip(
    true,
    'No seeded guest portal in CI (needs org slug + portal fixture). Track under BQR-5.2 residual / pilot fixtures.',
  )

  await page.goto('/p/test-org/test-portal')
  await expect(page.getByRole('heading', { name: /Test Portal/i })).toBeVisible()
  await expect(page.getByRole('radio', { name: '1 star' })).toBeVisible()
  await expect(page.getByRole('radio', { name: '5 stars' })).toBeVisible()
  await page.getByRole('radio', { name: '4 stars' }).click()
  await expect(page.getByText('Thank you for your feedback!')).toBeVisible()
  const feedbackTextarea = page.getByPlaceholder(/Tell us more/i)
  await expect(feedbackTextarea).toBeVisible()
  await feedbackTextarea.fill('Great experience!')
  await page.getByRole('button', { name: 'Send Feedback' }).click()
  await expect(page.getByText('Thank you for your feedback!').nth(1)).toBeVisible()
})
