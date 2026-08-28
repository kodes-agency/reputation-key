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

  test('public gateway tolerates unavailable browser storage and orientation changes', async ({
    page,
  }) => {
    const seed = requireE2eSeedState()
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get: () => {
          throw new DOMException('Storage is unavailable', 'SecurityError')
        },
      })
      Object.defineProperty(window, 'sessionStorage', {
        configurable: true,
        get: () => {
          throw new DOMException('Storage is unavailable', 'SecurityError')
        },
      })
    })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`/p/${seed.portalToken}`)

    await expect(page.getByRole('radio', { name: '5 stars' })).toBeVisible()
    await page.setViewportSize({ width: 844, height: 390 })
    await expectNoHorizontalOverflow(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)
    await assertNoAxeViolations(page, 'compatibility blocked-storage rating gateway')
  })

  test('public gateway renders its complete Bulgarian language contract', async ({
    page,
  }) => {
    const seed = requireE2eSeedState()
    await page.goto(`/p/${seed.portalToken}?locale=bg`)

    await expect(page.locator('html')).toHaveAttribute('lang', 'bg')
    await expect(page.getByRole('navigation', { name: 'Език' })).toBeVisible()
    await expect(page.getByRole('radio', { name: '1 звезда' })).toBeVisible()
    await expect(page.getByRole('radio', { name: '5 звезди' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await assertNoAxeViolations(page, 'compatibility Bulgarian rating gateway')
  })

  test('an unknown public address fails closed with an accessible unavailable state', async ({
    page,
  }) => {
    await page.goto('/p/repkey-compatibility-missing-portal')

    await expect(page.getByText('This portal is no longer available')).toBeVisible()
    await expect(page.getByRole('radio')).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
    await assertNoAxeViolations(page, 'compatibility unavailable public gateway')
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
