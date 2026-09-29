// Bell popover on phones: real-browser geometry against Storybook, where
// Tailwind is compiled. The Vitest story runner compiles none, so a width or a
// height asserted there measures an unstyled document. Run with
// `pnpm test:storybook:metrics` (see `playwright.storybook.config.ts`).
//
// The popover was a fixed 24rem with no viewport cap and no collision padding.
// Radix positions it `fixed` and shifts it to the left edge, so on a 320 px
// phone 64 px of it (every row's last control, the timestamps, "Mark all
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

    const layer = page.locator('[data-slot="popover-content"]')
    const popover = await boxOf(layer)
    expect(popover.x, 'left edge').toBeGreaterThanOrEqual(0)
    expect(popover.x + popover.width, 'right edge').toBeLessThanOrEqual(viewport.width)
    expect(popover.y + popover.height, 'bottom edge').toBeLessThanOrEqual(viewport.height)

    // The two filter tabs (All, Unread) share one line, even at 320 px, and
    // the list starts below them. Six tabs used to wrap onto a second line.
    const tabs = await boxOf(layer.getByRole('tablist', { name: 'Filter notifications' }))
    const tabBoxes = await Promise.all((await layer.getByRole('tab').all()).map(boxOf))
    expect(tabBoxes).toHaveLength(2)
    for (const tab of tabBoxes) {
      expect(
        Math.abs(tab.y - tabBoxes[0]!.y),
        'a filter tab off the first line',
      ).toBeLessThan(1)
      expect(tab.y + tab.height, 'a filter tab').toBeLessThanOrEqual(tabs.y + tabs.height)
      expect(tab.x + tab.width, 'a filter tab').toBeLessThanOrEqual(viewport.width)
    }
    const firstGroup = await boxOf(layer.getByRole('heading', { name: 'New' }))
    expect(tabs.y + tabs.height, 'the filter tabs').toBeLessThanOrEqual(firstGroup.y)

    // Each row's last control, its menu button, is on screen: nothing is cut
    // off at the side. It is transparent until the row is hovered or focused,
    // but it keeps its box.
    const rows = await layer.locator('li[data-notification-id]').count()
    const menuButtons = await layer
      .getByRole('button', { name: /^More actions for:/ })
      .all()
    expect(menuButtons).toHaveLength(rows)
    for (const button of menuButtons) {
      const box = await boxOf(button)
      expect(box.x + box.width, 'a row menu button').toBeLessThanOrEqual(viewport.width)
    }

    // The footer is reachable without scrolling the page, which cannot move
    // a fixed layer; the list scrolls inside the popover instead.
    await expect(
      page.getByRole('link', { name: 'View all notifications' }),
    ).toBeInViewport({ ratio: 1 })
  })
}

// ── The unread dot ──────────────────────────────────────────────────────────
//
// Unread rows used to be drawn on `--surface-elevated`, a lift the light
// popover could not show (1.00:1: it is white as well). The cue is now a dot
// beside the row's icon, with a heavier title. A read row has none, and so has
// a done one: settled upstream, still unread, but asking for nothing. The
// Vitest runner compiles no CSS, so only a real browser can say the dot is
// drawn — sized, inside its row, and standing off the popover by WCAG 1.4.11's
// 3:1 (measured 3.76:1 dark, 9.21:1 light).

/** The dot: the one element beside the icon in the link's icon slot. */
const DOT = '[data-row-control="open"] > [aria-hidden="true"] > span'

/** WCAG contrast between an element's background and what shows behind it. */
async function contrastOf(dot: Locator): Promise<number> {
  return dot.evaluate((element) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context === null) throw new Error('no 2d canvas')
    // The canvas resolves any CSS colour, oklch included, to sRGB bytes.
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      return Array.from(context.getImageData(0, 0, 1, 1).data)
    }
    const backgroundBehind = (from: Element | null): number[] => {
      for (let node = from; node !== null; node = node.parentElement) {
        const color = rgba(getComputedStyle(node).backgroundColor)
        if (color[3] === 255) return color
      }
      throw new Error('no opaque background behind the dot')
    }
    const luminance = ([r, g, b]: number[]) => {
      const linear = (channel: number) => {
        const c = channel / 255
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
    }
    const own = luminance(backgroundBehind(element))
    const behind = luminance(backgroundBehind(element.parentElement))
    return (Math.max(own, behind) + 0.05) / (Math.min(own, behind) + 0.05)
  })
}

for (const theme of ['dark', 'light'] as const) {
  test(`an unread row shows its dot and a done row does not, ${theme} theme`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await openStory(page, theme === 'light' ? `${STORY}-light` : STORY)
    const rows = page.locator('[data-slot="popover-content"] li[data-notification-id]')
    const unread = rows.and(page.locator('[data-notification-state="unread"]'))
    const done = rows.and(page.locator('[data-notification-state="done"]'))
    const read = rows.and(page.locator('[data-notification-state="read"]'))
    // The story's feed: four unread rows, one done, five read.
    await expect(unread).toHaveCount(4)
    await expect(done).toHaveCount(1)

    await expect(unread.locator(DOT)).toHaveCount(4)
    const dot = unread.first().locator(DOT)
    await expect(dot).toBeVisible()
    const box = await boxOf(dot)
    const row = await boxOf(unread.first())
    expect(box.width, 'the dot is drawn').toBeGreaterThanOrEqual(4)
    expect(box.height, 'the dot is drawn').toBeGreaterThanOrEqual(4)
    expect(box.x, 'the dot inside its row').toBeGreaterThanOrEqual(row.x)
    expect(box.y, 'the dot inside its row').toBeGreaterThanOrEqual(row.y)
    expect(box.x + box.width, 'the dot inside its row').toBeLessThanOrEqual(
      row.x + row.width,
    )
    expect(await contrastOf(dot)).toBeGreaterThanOrEqual(3)

    await expect(done.locator(DOT)).toHaveCount(0)
    await expect(read.locator(DOT)).toHaveCount(0)
  })
}

// ── Opening the bell arms nothing, visibly ──────────────────────────────────
//
// Radix used to focus "Mark all read" on open, and after a pointer open no ring
// showed it, so one stray Space marked everything read. Focus now starts on the
// notification list. A keyboard open must SHOW it there: `:focus-visible`
// follows real key presses, which the Vitest story runner cannot send, and the
// ring is a compiled Tailwind class the runner does not have.

test('a keyboard open puts visible focus on the list, not on "Mark all read"', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openStory(page, STORY)
  // The play opened the bell by pointer. Close it; Radix returns focus to the
  // bell, and a key opens it again.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Notifications' })).toHaveCount(0)
  await page.keyboard.press('Enter')

  const list = page.locator('[data-slot="popover-content"] [data-notification-list]')
  await expect(list).toBeFocused()
  expect(await list.evaluate((element) => element.matches(':focus-visible'))).toBe(true)
  expect(await list.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe(
    'none',
  )

  // Space on the list changes nothing: "Mark all read" is still offered, and
  // the four unread rows are still unread.
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: /mark all read/i })).toBeVisible()
  await expect(
    page.locator('[data-slot="popover-content"] li[data-notification-state="unread"]'),
  ).toHaveCount(4)
})
