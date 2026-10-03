// The link layer against Storybook, where Tailwind is compiled. The Vitest story
// runner compiles none, so "a nav link takes the ink its classes name" and "the
// sidebar's open entry is accent-muted and semibold" cannot be read back there
// (`src/components/ui/link-ink.stories.tsx` covers what it can). Run with
// `pnpm test:storybook:metrics` (see `playwright.storybook.config.ts`).
//
// Before the global anchor default moved into `@layer base`, it sat outside
// every layer and beat every utility on every anchor: nav labels, breadcrumbs
// and menu items rendered accent whatever their classes said, an `underline`
// class on a link did nothing, and the sidebar's active look lived in global
// CSS, out of reach of `ui/sidebar.tsx` (UI consistency scan: FRAME-06,
// NAV-02, ACT-19).
//
// Each link is compared with the TOKEN it should take, painted on a throwaway
// element, so the test names a design token and not a colour string, and runs in
// both themes.

import { expect, test, type Page } from '@playwright/test'
import { openStory } from './storybook-story'

const STORIES = {
  dark: 'patterns-link-ink--dark',
  light: 'patterns-link-ink--light',
} as const

type Token =
  | 'accent'
  | 'foreground'
  | 'muted-foreground'
  | 'popover-foreground'
  | 'primary-foreground'
  | 'destructive'
  | 'sidebar-foreground'
  | 'sidebar-accent'

/** What the browser computes for `var(--token)` as a colour, in the page's theme. */
async function tokenColour(page: Page, token: Token): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span')
    probe.style.color = `var(--${name})`
    document.body.append(probe)
    const colour = getComputedStyle(probe).color
    probe.remove()
    return colour
  }, token)
}

type LinkStyle = Readonly<{
  color: string
  decoration: string
  weight: string
  background: string
}>

async function styleOf(page: Page, testId: string): Promise<LinkStyle> {
  return page.getByTestId(testId).evaluate((element) => {
    const computed = getComputedStyle(element)
    return {
      color: computed.color,
      decoration: computed.textDecorationLine,
      weight: computed.fontWeight,
      background: computed.backgroundColor,
    }
  })
}

for (const [theme, story] of Object.entries(STORIES)) {
  test.describe(`link ink, ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await openStory(page, story)
    })

    test('a plain link is a content link: accent, undecorated', async ({ page }) => {
      const link = await styleOf(page, 'content-link')

      expect(link.color).toBe(await tokenColour(page, 'accent'))
      expect(link.decoration).toBe('none')
    })

    test('navigation links take the ink their classes name', async ({ page }) => {
      expect((await styleOf(page, 'nav-active')).color).toBe(
        await tokenColour(page, 'foreground'),
      )
      expect((await styleOf(page, 'nav-inactive')).color).toBe(
        await tokenColour(page, 'muted-foreground'),
      )
      // A hovered inactive link moves to the foreground, as its classes say.
      await page.getByTestId('nav-inactive').hover()
      await expect
        .poll(async () => (await styleOf(page, 'nav-inactive')).color)
        .toBe(await tokenColour(page, 'foreground'))
    })

    test('an underline class on a link underlines it', async ({ page }) => {
      expect((await styleOf(page, 'pinned-link')).decoration).toBe('underline')
    })

    test('a breadcrumb ancestor reads as the trail, not as an accent link', async ({
      page,
    }) => {
      expect((await styleOf(page, 'breadcrumb-ancestor')).color).toBe(
        await tokenColour(page, 'muted-foreground'),
      )
    })

    test('a link drawn as a button keeps the button ink', async ({ page }) => {
      expect((await styleOf(page, 'button-link')).color).toBe(
        await tokenColour(page, 'primary-foreground'),
      )
    })

    test('a link in a menu takes the ink of the menu, with no pin', async ({ page }) => {
      expect((await styleOf(page, 'menu-link')).color).toBe(
        await tokenColour(page, 'popover-foreground'),
      )
      expect((await styleOf(page, 'menu-link-destructive')).color).toBe(
        await tokenColour(page, 'destructive'),
      )
    })

    test('the sidebar look comes from the primitive', async ({ page }) => {
      const active = await styleOf(page, 'sidebar-active')
      const inactive = await styleOf(page, 'sidebar-inactive')
      const sidebarInk = await tokenColour(page, 'sidebar-foreground')

      expect(active.color).toBe(sidebarInk)
      expect(inactive.color).toBe(sidebarInk)
      expect(active.background).toBe(await tokenColour(page, 'sidebar-accent'))
      expect(active.weight).toBe('600')
      expect(inactive.weight).not.toBe('600')

      const iconInk = await page
        .getByTestId('sidebar-active')
        .locator('svg')
        .first()
        .evaluate((icon) => getComputedStyle(icon).color)
      expect(iconInk).toBe(await tokenColour(page, 'accent'))
    })
  })
}
