// Bell popover on phones: real-browser geometry against Storybook, where
// Tailwind is compiled. The Vitest story runner compiles none, so a width or a
// height asserted there measures an unstyled document. Run with
// `pnpm test:storybook:metrics` (see `playwright.storybook.config.ts`).
//
// The popover was a fixed 24rem with no viewport cap and no collision padding.
// Radix positions it `fixed` and shifts it to the left edge, so on a 320 px
// phone 64 px of it (every row's dismiss button, the timestamps, "Mark all
// read") sat past the right edge where the page cannot scroll, and on a
// landscape phone the list and "View all notifications" fell below the fold.
//
// The story puts the bell where the app does, at the right end of the top bar,
// and its play opens it; `openStory` waits until that play has finished and
// the popover's entry animation has settled.

import { expect, test, type Locator } from '@playwright/test'
import { openStory } from './storybook-story'

const STORY = 'notification-notificationpanel--phone-top-bar'

const VIEWPORTS = [
  { name: '320 x 640 portrait', width: 320, height: 640 },
  { name: '360 x 740 portrait', width: 360, height: 740 },
  { name: '375 x 667 portrait', width: 375, height: 667 },
  { name: '667 x 375 landscape', width: 667, height: 375 },
] as const

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('element has no box: it is not rendered')
  return box
}

for (const viewport of VIEWPORTS) {
  test(`the bell popover fits a ${viewport.name} phone`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await openStory(page, STORY)

    const popover = await boxOf(page.locator('[data-slot="popover-content"]'))
    expect(popover.x, 'left edge').toBeGreaterThanOrEqual(0)
    expect(popover.x + popover.width, 'right edge').toBeLessThanOrEqual(viewport.width)
    expect(popover.y + popover.height, 'bottom edge').toBeLessThanOrEqual(viewport.height)

    // Narrower than 24rem the six filter tabs wrap onto a second line; the
    // list must start below them, not under them.
    const tabs = await boxOf(page.getByRole('tablist', { name: 'Filter notifications' }))
    const lastTab = await boxOf(page.getByRole('tab').last())
    const firstGroup = await boxOf(page.getByRole('heading', { name: 'New' }))
    expect(lastTab.y + lastTab.height, 'the last filter tab').toBeLessThanOrEqual(
      tabs.y + tabs.height,
    )
    expect(tabs.y + tabs.height, 'the filter tabs').toBeLessThanOrEqual(firstGroup.y)

    // Each row's last control is on screen: nothing is cut off at the side.
    const dismissButtons = await page.getByRole('button', { name: /^Dismiss:/ }).all()
    expect(dismissButtons.length).toBeGreaterThan(0)
    for (const button of dismissButtons) {
      const box = await boxOf(button)
      expect(box.x + box.width, 'a dismiss button').toBeLessThanOrEqual(viewport.width)
    }

    // The footer is reachable without scrolling the page, which cannot move
    // a fixed layer; the list scrolls inside the popover instead.
    await expect(
      page.getByRole('link', { name: 'View all notifications' }),
    ).toBeInViewport({ ratio: 1 })
  })
}
