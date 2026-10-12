// The language chip and its sheet on the SEEDED v3 portal (round 4, verification
// slice G). The Storybook stories drive the sheet in isolation and
// `compatibility/core-surfaces.spec.ts` loads `?locale=` directly; nothing
// opened the sheet on the live route and followed a row, which is the path a
// guest takes: chip, sheet, row, the same portal in another language.
//
// Chromium only (the `critical` project). It needs the seeded stack, like every
// spec in this directory; the seed publishes the portal in English and
// Bulgarian at least, and the English and Bulgarian packs name the chip
// "EN, Language" and "БГ, Език".

import type { Page } from '@playwright/test'
import { test, expect } from '../helpers/error-detection'
import { requireE2eSeedState } from '../helpers/seed-state'
import { resetGuestRateLimits } from '../helpers/fixtures'
import { waitForHydration } from '../helpers/interaction'

const seed = requireE2eSeedState()

const ENGLISH_CHIP = /^EN, Language/
const BULGARIAN_CHIP = /^БГ, Език/

/** The row of the sheet that goes to one language: a plain link with `hreflang`. */
const sheetRow = (page: Page, locale: string) =>
  page.getByRole('dialog').locator(`a[hreflang="${locale}"]`)

/** Open the portal in a language and wait until the chip answers a click. */
async function openPortalIn(page: Page, locale: string): Promise<void> {
  await page.goto(`/p/${seed.portalToken}?locale=${locale}`)
  await waitForHydration(page)
}

test.describe('Critical: guest language sheet on the live route', () => {
  test.beforeEach(async () => {
    await resetGuestRateLimits()
  })

  test('the chip opens the sheet and a row switches ?locale= and the page language', async ({
    page,
  }) => {
    await openPortalIn(page, 'en')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('radio', { name: '5 stars, Excellent' })).toBeVisible()

    await page.getByRole('button', { name: ENGLISH_CHIP }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(sheetRow(page, 'en')).toHaveAttribute('aria-current', 'page')
    await expect(sheetRow(page, 'bg')).toBeVisible()

    await sheetRow(page, 'bg').click()
    await expect(page).toHaveURL(/\/p\/[^?]+\?locale=bg(&|$)/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'bg')
    await expect(page.getByRole('button', { name: BULGARIAN_CHIP })).toBeVisible()
    await expect(page.getByRole('radio', { name: /^1 звезда/ })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // And back: the sheet of the Bulgarian page offers English the same way.
    await waitForHydration(page)
    await page.getByRole('button', { name: BULGARIAN_CHIP }).click()
    await expect(sheetRow(page, 'bg')).toHaveAttribute('aria-current', 'page')
    await sheetRow(page, 'en').click()
    await expect(page).toHaveURL(/\/p\/[^?]+\?locale=en(&|$)/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('button', { name: ENGLISH_CHIP })).toBeVisible()
    await expect(page.getByRole('radio', { name: '1 star, Poor' })).toBeVisible()
  })

  test('choosing the current language, or pressing Escape, closes the sheet and stays put', async ({
    page,
  }) => {
    await openPortalIn(page, 'en')
    const url = page.url()
    const chip = page.getByRole('button', { name: ENGLISH_CHIP })
    // The current row's address is the page's own, so the URL cannot tell a
    // reload from no navigation: a marker on the window does (a reload clears it).
    await page.evaluate(() => {
      ;(window as unknown as { __stayedPut?: boolean }).__stayedPut = true
    })

    await chip.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await sheetRow(page, 'en').click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(page.url()).toBe(url)
    await expect(chip).toBeFocused()

    await chip.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(chip).toBeFocused()
    expect(page.url()).toBe(url)
    const stayedPut = await page.evaluate(
      () => (window as unknown as { __stayedPut?: boolean }).__stayedPut === true,
    )
    expect(stayedPut, 'the page reloaded instead of staying put').toBe(true)
  })
})
