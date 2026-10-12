// LinkTabs against Storybook, where Tailwind is compiled. The Vitest story runner
// compiles none, so "a tab is 36px on a desktop and a tap target on a phone", "the
// row scrolls to the current tab and fades the side that continues" and "the current
// tab wears the primary underline" cannot be read back there
// (`src/components/ui/link-tabs.stories.tsx` covers what it can). Run with
// `pnpm test:storybook:metrics` (see `playwright.storybook.config.ts`).

import { expect, test, type Page } from '@playwright/test'
import { openStory } from './storybook-story'

const STORIES = {
  route: 'patterns-view-tabs--route-views',
  strip: 'patterns-view-tabs--strip-opens-on-the-last-tab',
  fits: 'patterns-view-tabs--strip-that-fits',
} as const

/** What the browser computes for `var(--token)` as a colour, in the page's theme. */
async function tokenColour(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span')
    probe.style.color = `var(--${name})`
    document.body.append(probe)
    const colour = getComputedStyle(probe).color
    probe.remove()
    return colour
  }, token)
}

const row = (page: Page) => page.locator('[data-slot="link-tabs"]')

test.describe('the height of a tab', () => {
  test('is 36px on a desktop, as every control is', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await openStory(page, STORIES.route)

    const heights = await page
      .locator('[data-slot="link-tab"]')
      .evaluateAll((tabs) => tabs.map((tab) => tab.getBoundingClientRect().height))

    expect(heights).toEqual([36, 36])
  })

  test('is a tap target on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await openStory(page, STORIES.route)

    const heights = await page
      .locator('[data-slot="link-tab"]')
      .evaluateAll((tabs) => tabs.map((tab) => tab.getBoundingClientRect().height))

    for (const height of heights) expect(height).toBeGreaterThanOrEqual(44)
  })
})

test.describe('the current tab', () => {
  test('wears the primary underline, and only it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await openStory(page, STORIES.route)

    const underlines = await page.locator('[data-slot="link-tab"]').evaluateAll((tabs) =>
      tabs.map((tab) => ({
        current: tab.getAttribute('aria-current') === 'page',
        fill: getComputedStyle(tab, '::after').backgroundColor,
        height: getComputedStyle(tab, '::after').height,
      })),
    )
    const primary = await tokenColour(page, 'primary')

    expect(underlines.filter((tab) => tab.current).map((tab) => tab.fill)).toEqual([
      primary,
    ])
    expect(underlines.filter((tab) => tab.current).map((tab) => tab.height)).toEqual([
      '2px',
    ])
    expect(underlines.filter((tab) => !tab.current).map((tab) => tab.fill)).not.toContain(
      primary,
    )
  })
})

test.describe('the row on a phone', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 })
    await openStory(page, STORIES.strip)
  })

  test('opens with the current tab in view, clear of the fade', async ({ page }) => {
    const view = await row(page).boundingBox()
    const item = await page.locator('[aria-current="page"]').boundingBox()

    expect(await row(page).evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    expect(item!.x).toBeGreaterThanOrEqual(view!.x)
    expect(item!.x + item!.width).toBeLessThanOrEqual(view!.x + view!.width)
  })

  test('fades the side that continues and hides its scrollbar', async ({ page }) => {
    expect(
      await row(page).evaluate((el) => (el as HTMLElement).style.maskImage),
    ).not.toBe('')
    expect(await row(page).evaluate((el) => getComputedStyle(el).scrollbarWidth)).toBe(
      'none',
    )
  })

  test('is still one row: the tabs scroll sideways instead of wrapping', async ({
    page,
  }) => {
    const tops = await page
      .locator('[data-slot="link-tab"]')
      .evaluateAll((tabs) => tabs.map((tab) => tab.getBoundingClientRect().top))

    expect(new Set(tops).size).toBe(1)
  })
})

test('a row whose tabs all fit draws no fade', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openStory(page, STORIES.fits)

  expect(await row(page).evaluate((el) => (el as HTMLElement).style.maskImage)).toBe('')
})
