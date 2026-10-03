// Bounded cross-browser/device release gate. These journeys intentionally make
// no product-data changes: they prove the public rating gateway (in English,
// Bulgarian, German and French) and the signed-
// in manager shell render, reflow, and pass the same page-level accessibility
// checks in Firefox, WebKit, Android-sized Chromium, and iPhone-sized WebKit.

import { expect, test } from '../helpers/error-detection'
import { assertNoAxeViolations } from '../helpers/a11y'
import { signIn } from '../helpers/auth'
import { expectPortalUnavailable } from '../helpers/guest-unavailable'
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
    await expect(page.getByRole('radio', { name: '1 star, Poor' })).toBeVisible()
    await expect(page.getByRole('radio', { name: '5 stars, Excellent' })).toBeVisible()
    // The seeded portal is a v3 publication: its Linktree is visible from
    // arrival, below the rating card (ADR 0044 as amended), and this gate stays
    // read-only, so the assertion is that the tile is there before any rating.
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

    await expect(page.getByRole('radio', { name: '5 stars, Excellent' })).toBeVisible()
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
    // The language chip names the selected language, and its sheet lists both.
    await expect(page.getByRole('button', { name: /^БГ, Език/ })).toBeVisible()
    await expect(page.getByRole('radio', { name: /^1 звезда/ })).toBeVisible()
    await expect(page.getByRole('radio', { name: /^5 звезди/ })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await assertNoAxeViolations(page, 'compatibility Bulgarian rating gateway')
  })

  // German has the longest words and French the accents and no-break
  // punctuation, so between them they cover what the other Latin-script packs
  // (es, it) could break: a word that will not wrap, a glyph a font lacks.
  for (const guest of [
    {
      locale: 'de',
      chip: /^DE, Sprache/,
      question: 'Wie hat es Ihnen gefallen?',
      first: /^1 Stern, Schlecht/,
      last: /^5 Sterne, Ausgezeichnet/,
      send: 'Privat senden',
    },
    {
      locale: 'fr',
      chip: /^FR, Langue/,
      question: /^Comment s’est passée votre expérience/,
      first: /^1 étoile, Mauvaise/,
      last: /^5 étoiles, Excellente/,
      send: 'Envoyer en privé',
    },
  ] as const) {
    test(`public gateway renders its complete ${guest.locale} language contract at 320 px`, async ({
      page,
    }) => {
      const seed = requireE2eSeedState()
      await page.setViewportSize({ width: 320, height: 640 })
      await page.goto(`/p/${seed.portalToken}?locale=${guest.locale}`)

      await expect(page.locator('html')).toHaveAttribute('lang', guest.locale)
      await expect(page.getByRole('button', { name: guest.chip })).toBeVisible()
      await expect(page.getByText(guest.question)).toBeVisible()
      await expect(page.getByRole('radio', { name: guest.first })).toBeVisible()
      await expect(page.getByRole('radio', { name: guest.last })).toBeVisible()
      await expect(page.getByRole('button', { name: guest.send })).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await assertNoAxeViolations(
        page,
        `compatibility ${guest.locale} rating gateway at 320 px`,
      )
    })
  }

  test('an unknown public address fails closed with an accessible unavailable state', async ({
    page,
  }) => {
    await page.goto('/p/repkey-compatibility-missing-portal')

    // 403 / 404 / 410 collapse to ONE posture on the public surface so a guest
    // cannot tell a bad token from a withdrawn Portal (see routes/p/$token.tsx).
    await expectPortalUnavailable(page)
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
