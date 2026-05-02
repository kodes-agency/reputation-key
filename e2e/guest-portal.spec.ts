import { test, expect } from '@playwright/test'

test('guest portal flow: visit, rate, feedback', async ({ page }) => {
  // Navigate to a test portal (requires seeded test data)
  await page.goto('/p/test-org/test-portal')

  // Page should load with portal name
  await expect(page.getByRole('heading', { name: /Test Portal/i })).toBeVisible()

  // Stars should be visible
  await expect(page.getByRole('radio', { name: '1 star' })).toBeVisible()
  await expect(page.getByRole('radio', { name: '5 stars' })).toBeVisible()

  // Click 4 stars
  await page.getByRole('radio', { name: '4 stars' }).click()

  // Should show thank you message
  await expect(page.getByText('Thank you for your feedback!')).toBeVisible()

  // Feedback form should still be visible (anti-gating)
  const feedbackTextarea = page.getByPlaceholder(/Tell us more/i)
  await expect(feedbackTextarea).toBeVisible()

  // Submit feedback
  await feedbackTextarea.fill('Great experience!')
  await page.getByRole('button', { name: 'Send Feedback' }).click()

  // Should show feedback confirmation
  await expect(page.getByText('Thank you for your feedback!').nth(1)).toBeVisible()
})
