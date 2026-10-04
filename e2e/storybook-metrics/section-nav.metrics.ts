// SectionNav against Storybook, where Tailwind is compiled. The Vitest story runner
// compiles none, so "the nav is a list in a wide space and a strip in a narrow one",
// "the current row is the sidebar's fill" and "a row is a tap target on a phone"
// cannot be read back there (`src/components/ui/section-nav.stories.tsx` covers what
// it can). Run with `pnpm test:storybook:metrics` (see
// `playwright.storybook.config.ts`).
//
// The point of the container switch is that the SAME nav answers to the width of the
// space it sits in, not of the window: the narrow story is a strip in a 1440 px
// window, and the wide one is a list in an 800 px window.

import { expect, test, type Page } from '@playwright/test'
import { openStory } from './storybook-story'

const STORIES = {
  narrow: 'patterns-section-nav--auto-in-a-narrow-space',
  wide: 'patterns-section-nav--auto-in-a-wide-space',
  list: 'patterns-section-nav--list',
  listLight: 'patterns-section-nav--list-light',
  withoutHeadings: 'patterns-section-nav--without-headings',
  strip: 'patterns-section-nav--strip-open-on-the-last-section',
  editor: 'portal-portaleditor--section-list',
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

/** The nav's scrolling element: a row when it is a strip, a column when a list. */
const scroller = (page: Page) => page.locator('[data-slot="section-nav-scroller"]')

async function layoutOf(page: Page) {
  return scroller(page).evaluate((element) => {
    const style = getComputedStyle(element)
    return { direction: style.flexDirection, overflowX: style.overflowX }
  })
}

test.describe('the container decides, not the window', () => {
  test('a narrow space is a strip even in a wide window', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openStory(page, STORIES.narrow)

    expect((await layoutOf(page)).direction).toBe('row')
    await expect(page.getByText('Responsible managers')).toBeHidden()
  })

  test('a wide space is a list even in a narrow window', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 })
    await openStory(page, STORIES.wide)

    expect((await layoutOf(page)).direction).toBe('column')
    await expect(page.getByText('Responsible managers')).toBeVisible()
  })
})

for (const [theme, story] of [
  ['dark', STORIES.list],
  ['light', STORIES.listLight],
] as const) {
  test.describe(`the list, ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await openStory(page, story)
    })

    test('the current row is the sidebar fill, and only it', async ({ page }) => {
      const nav = page.getByRole('navigation', { name: 'Account settings' })
      const fill = await tokenColour(page, 'accent-muted')
      const rows = nav.getByRole('link')
      const backgrounds = await rows.evaluateAll((links) =>
        links.map((link) => getComputedStyle(link).backgroundColor),
      )
      const current = await rows.evaluateAll((links) =>
        links.map((link) => link.getAttribute('aria-current') === 'page'),
      )

      expect(backgrounds.filter((_, index) => current[index])).toEqual([fill])
      expect(backgrounds.filter((_, index) => !current[index])).not.toContain(fill)
      expect(await tokenColour(page, 'sidebar-accent')).toBe(fill)
    })

    test('a keyboard-focused row has the shared ring, not an outline', async ({
      page,
    }) => {
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      const focused = await page.evaluate(() => {
        const style = getComputedStyle(document.activeElement as Element)
        return { shadow: style.boxShadow, outline: style.outlineStyle }
      })

      expect(focused.shadow).toContain('3px')
      expect(focused.outline).toBe('none')
    })
  })
}

test.describe('the Danger zone stays apart', () => {
  test('it is 20px below the last row whether or not it is the open section', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await openStory(page, STORIES.withoutHeadings)

    const nav = page.getByRole('navigation', { name: 'Property settings sections' })
    const box = async (name: string) =>
      nav.getByRole('link', { name: new RegExp(`^${name}`) }).boundingBox()
    const [people, targets, danger] = await Promise.all([
      box('People'),
      box('Targets'),
      box('Danger zone'),
    ])

    // The story opens on the Danger zone: the gap above it is the group's, with no
    // offset that depends on being current.
    expect(Math.round(danger!.y - (targets!.y + targets!.height))).toBe(20)
    expect(Math.round(targets!.y - (people!.y + people!.height))).toBe(4)
  })
})

test.describe('the strip on a phone', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 })
    await openStory(page, STORIES.strip)
  })

  test('keeps the open section in view and fades the side that continues', async ({
    page,
  }) => {
    const current = page.locator('[aria-current="page"]')
    const view = await scroller(page).boundingBox()
    const item = await current.boundingBox()

    expect(item!.x).toBeGreaterThanOrEqual(view!.x)
    expect(item!.x + item!.width).toBeLessThanOrEqual(view!.x + view!.width)
    expect(
      await scroller(page).evaluate((el) => (el as HTMLElement).style.maskImage),
    ).not.toBe('')
  })

  test('hides its scrollbar and makes every row a tap target', async ({ page }) => {
    expect(
      await scroller(page).evaluate((el) => getComputedStyle(el).scrollbarWidth),
    ).toBe('none')
    const heights = await page
      .getByRole('navigation', { name: 'Property settings sections' })
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getBoundingClientRect().height))

    for (const height of heights) expect(height).toBeGreaterThanOrEqual(44)
  })
})

test.describe('the Portal editor list', () => {
  test('is a 288px bordered column that stays in view, from a wide container', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openStory(page, STORIES.editor)
    const nav = page.getByRole('navigation', { name: 'Editor sections' })

    expect((await nav.boundingBox())!.width).toBe(288)
    expect(await nav.evaluate((el) => getComputedStyle(el).borderRightWidth)).toBe('1px')
    expect(await scroller(page).evaluate((el) => getComputedStyle(el).position)).toBe(
      'sticky',
    )
    await expect(page.getByText('Photo and colours · property-wide')).toBeVisible()
  })

  test('is a band above the section until the container has room for three columns', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1100, height: 900 })
    await openStory(page, STORIES.editor)
    const nav = page.getByRole('navigation', { name: 'Editor sections' })

    expect((await layoutOf(page)).direction).toBe('row')
    expect(await nav.evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe('1px')
    await expect(page.getByText('Photo and colours · property-wide')).toBeHidden()
    const heights = await nav
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getBoundingClientRect().height))
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(44)
  })
})
