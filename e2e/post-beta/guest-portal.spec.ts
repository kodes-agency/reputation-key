// post-beta: portal.read is dark for beta — positive pilot coverage resumes
// when the capability posture changes; denial covered by
// e2e/critical/dark-promotion.spec.ts.
//
// E2E: Guest portal public flow (POSITIVE pilot coverage).
// Requires a seeded public portal (/p/{org}/{portal}) — nothing seeds portals
// today (portal.write is BLOCKED, so the UI/API create path is unreachable;
// a DB fixture would be needed). The slugs below are placeholders from the
// pre-dark suite. This suite is excluded from both Playwright projects
// (testIgnore 'post-beta/' in playwright.config.ts); the skip stays so an
// accidental inclusion still cannot run a hardcoded-slug flow.

import { test, expect } from '../helpers/error-detection'

test('guest portal flow: visit, rate, feedback', async ({ page }) => {
  test.skip(
    true,
    'post-beta: portal.read is dark for beta; no seeded guest portal fixture. Enable with the posture change + a portal seed fixture.',
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
