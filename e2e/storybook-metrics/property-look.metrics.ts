// The Property look page against Storybook, where Tailwind is compiled. The
// Vitest story runner compiles none, so "three columns from 90 rem", "the
// side columns stay in view" and "nothing scrolls sideways" cannot be asserted
// there. Run with `pnpm test:storybook:metrics` (see
// `playwright.storybook.config.ts`).
//
// Board 09 puts the form, the phone and "Portals using this look" in three
// columns. Stacked under a phone of about 600 px inside one sticky box the
// portal picker sat below the fold at 1440 x 900, and the box was taller than
// the screen. From 90 rem the phone and the picker are columns of their own;
// below it they stack in the right-hand column and scroll with the page.

import { expect, test, type Page } from '@playwright/test'
import { openStory } from './storybook-story'

const STORY = 'portal-propertylook-propertylookpage--default'

const WIDTHS = [320, 375, 768, 1024, 1440, 1920] as const
/** Tailwind's `min-[90rem]`: the picker gets a column of its own. */
const THREE_COLUMNS_FROM = 1440
const VIEWPORT_HEIGHT = 900

const PHONE = { name: /preview of the guest page/i } as const

async function boxesOf(page: Page) {
  const phone = page.getByRole('region', PHONE)
  const portals = page.getByRole('heading', { name: 'Portals using this look' })
  const form = page.getByRole('heading', { name: 'Colours' })
  await expect(phone).toBeVisible()
  const [phoneBox, portalsBox, formBox] = await Promise.all([
    phone.boundingBox(),
    portals.boundingBox(),
    form.boundingBox(),
  ])
  if (phoneBox === null || portalsBox === null || formBox === null) {
    throw new Error('the phone, the portal heading or the form has no box')
  }
  return { phoneBox, portalsBox, formBox }
}

for (const width of WIDTHS) {
  test(`the look page fits a ${width}px window without scrolling sideways`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: VIEWPORT_HEIGHT })
    await openStory(page, STORY)

    const { phoneBox, portalsBox, formBox } = await boxesOf(page)

    const documentScrolls = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(documentScrolls, 'the document scrolls sideways').toBe(false)
    for (const [name, box] of [
      ['phone', phoneBox],
      ['portal heading', portalsBox],
      ['form', formBox],
    ] as const) {
      expect(box.x, `the ${name} starts left of the window`).toBeGreaterThanOrEqual(-1)
      expect(box.x + box.width, `the ${name} runs past the window`).toBeLessThanOrEqual(
        width + 1,
      )
    }

    if (width >= THREE_COLUMNS_FROM) {
      expect(
        portalsBox.x,
        'the picker is a column beside the phone',
      ).toBeGreaterThanOrEqual(phoneBox.x + phoneBox.width - 1)
      expect(phoneBox.x, 'the phone is a column beside the form').toBeGreaterThanOrEqual(
        formBox.x + 200,
      )
    } else if (width >= 1024) {
      expect(phoneBox.x, 'the phone sits beside the form').toBeGreaterThan(formBox.x)
      expect(portalsBox.y, 'the picker is under the phone').toBeGreaterThanOrEqual(
        phoneBox.y + phoneBox.height - 1,
      )
    } else {
      expect(phoneBox.y, 'the phone is under the form').toBeGreaterThan(formBox.y)
    }
  })
}

for (const width of [1440, 1920] as const) {
  test(`at ${width} x ${VIEWPORT_HEIGHT} the phone and the portal picker are on screen`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: VIEWPORT_HEIGHT })
    await openStory(page, STORY)

    const { phoneBox, portalsBox } = await boxesOf(page)

    expect(phoneBox.y + phoneBox.height, 'the phone is cut off').toBeLessThanOrEqual(
      VIEWPORT_HEIGHT,
    )
    expect(portalsBox.y, 'the portal picker is below the fold').toBeLessThan(
      VIEWPORT_HEIGHT - 120,
    )
    // Scrolled to the bottom, both side columns are still on screen.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    const after = await boxesOf(page)
    expect(after.phoneBox.y, 'the phone scrolled away').toBeGreaterThanOrEqual(0)
    expect(after.portalsBox.y, 'the picker scrolled away').toBeGreaterThanOrEqual(0)
  })
}
