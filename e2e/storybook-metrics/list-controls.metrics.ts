// The small controls of a list against Storybook, where Tailwind is compiled: the
// search field's X and a removable chip. The Vitest story runner compiles none, so
// "a tap target below md" cannot be read back there. Run with
// `pnpm test:storybook:metrics` (see `playwright.storybook.config.ts`).
//
// Owner decision 1 (UI consistency plan): a control is at least 44px below `md`
// (36px in a compact workspace, which the Inbox checks in `inbox-phone.metrics.ts`)
// and keeps its desktop size from `md`. The X is a 12px glyph in a 24px button and
// the chip a 32px pill, so each needs the touch height stated, and the field around
// the X must not grow to hold it.

import { expect, test, type Page } from '@playwright/test'
import { openStory } from './storybook-story'

const SEARCHING = 'patterns-list-toolbar--narrowed-light'
const CHIPS = 'patterns-removable-chip--chips'

const PHONE = { width: 390, height: 800 } as const
const DESKTOP = { width: 1280, height: 800 } as const

const TOUCH_PX = 44

type Box = Readonly<{ width: number; height: number }>

/** The border box of the first element a selector finds. */
async function boxOf(page: Page, selector: string): Promise<Box> {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const { width, height } = element.getBoundingClientRect()
      return { width, height }
    })
}

const clearX = (page: Page) =>
  page.locator('[data-slot="input-group"]').getByRole('button', { name: 'Clear search' })

async function xBox(page: Page): Promise<Box> {
  return clearX(page).evaluate((element) => {
    const { width, height } = element.getBoundingClientRect()
    return { width, height }
  })
}

test.describe('the search field’s X', () => {
  test('is a tap target on a phone, and the field around it is the touch height, not taller', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE)
    await openStory(page, SEARCHING)

    const x = await xBox(page)
    expect(x.width, 'the X’s width').toBeGreaterThanOrEqual(TOUCH_PX)
    expect(x.height, 'the X’s height').toBeGreaterThanOrEqual(TOUCH_PX)
    const field = await boxOf(page, '[data-slot="input-group"]')
    expect(field.height, 'the field’s height').toBe(TOUCH_PX)
  })

  test('keeps its 24px glyph button from md', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await openStory(page, SEARCHING)

    expect(await xBox(page)).toEqual({ width: 24, height: 24 })
    const field = await boxOf(page, '[data-slot="input-group"]')
    expect(field.height, 'the field’s height').toBe(36)
  })
})

test.describe('a removable chip', () => {
  test('is a tap target on a phone', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await openStory(page, CHIPS)

    const heights = await page
      .locator('[data-slot="removable-chip"]')
      .evaluateAll((chips) => chips.map((chip) => chip.getBoundingClientRect().height))

    expect(heights.length).toBeGreaterThan(0)
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(TOUCH_PX)
  })

  test('is the 32px pill from md', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await openStory(page, CHIPS)

    const heights = await page
      .locator('[data-slot="removable-chip"]')
      .evaluateAll((chips) => chips.map((chip) => chip.getBoundingClientRect().height))

    expect(heights.length).toBeGreaterThan(0)
    for (const height of heights) expect(height).toBe(32)
  })
})
