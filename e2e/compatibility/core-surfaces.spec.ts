// Bounded cross-browser/device release gate. These journeys intentionally make
// no product-data changes: they prove the public rating gateway and the signed-
// in manager shell render, reflow, and pass the same page-level accessibility
// checks in Firefox, WebKit, Android-sized Chromium, and iPhone-sized WebKit.

import { expect, test } from '../helpers/error-detection'
import { assertNoAxeViolations } from '../helpers/a11y'
import { signIn } from '../helpers/auth'
import { requireE2eSeedState } from '../helpers/seed-state'

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true)
}

test.describe('Compatibility: core surfaces', () => {
  test('public rating gateway renders and reflows without recording a response', async ({
    page,
  }) => {
    const seed = requireE2eSeedState()
    await page.goto(`/p/${seed.portalToken}`)

    await expect(page.getByRole('heading', { name: 'E2E Guest Portal P1' })).toBeVisible()
    await expect(page.getByRole('radio', { name: '1 star' })).toBeVisible()
    await expect(page.getByRole('radio', { name: '5 stars' })).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Visit example review destination' }),
    ).toBeVisible()

    await expectNoHorizontalOverflow(page)
    await assertNoAxeViolations(page, 'compatibility public rating gateway')
  })

  test('authenticated manager shell renders and reflows without changing product data', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto('/settings/members')

    await expect(page.getByRole('heading', { name: /^members$/i }).first()).toBeVisible({
      timeout: 15_000,
    })
    await expectNoHorizontalOverflow(page)
    await assertNoAxeViolations(page, 'compatibility manager members shell')
  })
})
