// The History tab against Storybook, where Tailwind is compiled. The Vitest
// story runner compiles none, so "the rail sits beside the ledger from 64 rem",
// "nothing scrolls sideways" and "a version's actions are reachable without
// hover" cannot be asserted there. Run with `pnpm test:storybook:metrics`.

import { expect, test } from '@playwright/test'
import { openStory } from './storybook-story'

const STORY = 'portal-portalhistory--all'
const OPEN_STORY = 'portal-portalhistory--make-live-again-open'

const WIDTHS = [320, 390, 768, 1024, 1440, 1920] as const
/** Tailwind's `lg`: the rail moves beside the ledger. */
const RAIL_BESIDE_FROM = 1024

for (const width of WIDTHS) {
  test(`the ledger and its rail fit a ${width}px window without scrolling sideways`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await openStory(page, STORY)

    const ledger = page.getByRole('region', { name: /history of pool & terrace/i })
    const rail = page.getByRole('complementary', { name: 'Versions' })
    await expect(ledger).toBeVisible()
    await expect(rail).toBeVisible()
    const [ledgerBox, railBox] = await Promise.all([
      ledger.boundingBox(),
      rail.boundingBox(),
    ])
    if (ledgerBox === null || railBox === null)
      throw new Error('the ledger or the rail has no box')

    if (width >= RAIL_BESIDE_FROM) {
      expect(railBox.x, 'the rail sits beside the ledger').toBeGreaterThanOrEqual(
        ledgerBox.x + ledgerBox.width - 1,
      )
    } else {
      expect(railBox.y, 'the rail sits under the ledger').toBeGreaterThanOrEqual(
        ledgerBox.y + ledgerBox.height - 1,
      )
    }
    const documentScrolls = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(documentScrolls, 'the document scrolls sideways').toBe(false)
  })
}

for (const width of [320, 390, 768, 1440] as const) {
  test(`the confirmation fits a ${width}px window and its buttons are on screen`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await openStory(page, OPEN_STORY)

    const confirmation = page.getByRole('region', { name: 'Make version 4 live again?' })
    await expect(confirmation).toBeVisible()
    await expect(
      confirmation.getByRole('button', { name: 'Make version 4 live' }),
    ).toBeInViewport({ ratio: 1 })
    await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeInViewport({
      ratio: 1,
    })
    // Neither button runs out of the panel, which a phone's width makes easy.
    const panel = await confirmation.boundingBox()
    for (const name of ['Cancel', 'Make version 4 live']) {
      const box = await confirmation.getByRole('button', { name }).boundingBox()
      if (panel === null || box === null) throw new Error(`no box for ${name}`)
      expect(box.x + box.width, `${name} runs out of the panel`).toBeLessThanOrEqual(
        panel.x + panel.width,
      )
    }
    const documentScrolls = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(documentScrolls, 'the document scrolls sideways').toBe(false)
  })
}

test('a version line shows View and Make live again on hover and on keyboard focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openStory(page, STORY)

  const button = page.getByRole('button', { name: 'Make live again… version 4' })
  // The two buttons share one wrapper, which carries the opacity.
  const actions = button.locator('xpath=..')
  await expect(actions).toHaveCSS('opacity', '0')
  await button.focus()
  await expect(actions).toHaveCSS('opacity', '1')
})
