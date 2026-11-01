import { test, expect } from '../helpers/error-detection'
import { dbQuery, resetGuestRateLimits, waitFor } from '../helpers/fixtures'
import { requireE2eSeedState } from '../helpers/seed-state'
import { settleGuestConsent } from '../helpers/guest-consent'

const seed = requireE2eSeedState()

test('a published direct Portal opens Google without a private response and counts the open', async ({
  page,
  context,
}) => {
  await resetGuestRateLimits()
  const opens = async () => {
    const rows = await dbQuery<{ count: string }>(
      `SELECT count(*)::text AS count FROM metric_readings
       WHERE portal_id = $1::uuid AND metric_key = 'portal.review_link_click'
         AND portal_destination_kind = 'google_review'`,
      [seed.directPortalId],
    )
    return Number(rows[0]?.count ?? 0)
  }
  const receipts = async () => {
    const rows = await dbQuery<{ count: string }>(
      `SELECT count(*)::text AS count FROM idempotency_receipts
       WHERE scope = 'guest_destination_action' AND payload->>'portalId' = $1
         AND payload->>'destinationKind' = 'google_review'`,
      [seed.directPortalId],
    )
    return Number(rows[0]?.count ?? 0)
  }
  const beforeReceipts = await receipts()
  const before = await opens()
  await context.route('https://search.google.com/**', (route) =>
    route.fulfill({ body: 'Google destination' }),
  )
  await page.goto(`/p/${seed.directPortalToken}`)
  await settleGuestConsent(page, 'immersive')
  await expect(
    page.getByRole('heading', { name: 'E2E Direct Google Portal' }),
  ).toBeVisible()
  await expect(page.getByRole('radio')).toHaveCount(0)
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Your response/u })).toHaveCount(0)
  await page.getByRole('button', { name: /^Continue to Google/u }).click()
  await expect(page).toHaveURL(/^https:\/\/search\.google\.com/u)
  await waitFor(async () => (await opens()) === before + 1, {
    description: 'direct Google open counted',
  })
  await page.goBack()
  await expect(page.getByRole('button', { name: /^Continue to Google/u })).toBeVisible()
  await page.getByRole('button', { name: /^Continue to Google/u }).click()
  await expect(page).toHaveURL(/^https:\/\/search\.google\.com/u)
  expect(await receipts()).toBe(beforeReceipts + 1)
  expect(await opens()).toBe(before + 1)
})
