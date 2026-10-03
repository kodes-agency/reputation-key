// The Dialog primitive against Storybook, where Tailwind is compiled (the Vitest
// story runner compiles none, so what is on screen cannot be asserted there).
// Run with `pnpm test:storybook:metrics` (see `playwright.storybook.config.ts`).
//
// `Patterns/Dialog` `TallContentScrolls` opens a dialog with forty lines. Whatever
// the window, the dialog stays inside it, its body scrolls, and the footer is
// pinned: Cancel and the primary action are on screen before the person has
// scrolled anywhere, and still there after they have scrolled to the end. The
// two-line title of `TitleLeavesRoomForTheCloseInAForm` ends clear of the corner
// close, and the header is left-aligned at every width.

import { expect, test, type Page } from '@playwright/test'
import { openStory } from './storybook-story'

const TALL_STORY = 'patterns-dialog--tall-content-scrolls'
const TITLE_STORY = 'patterns-dialog--title-leaves-room-for-the-close-in-a-form'

const WINDOWS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 1280, height: 500 },
  { width: 1440, height: 900 },
] as const

/** The smallest gap, in px, between a title's last line and the corner close. */
const MIN_TITLE_GAP_PX = 8

async function footerButtonsAreInside(page: Page, height: number) {
  for (const name of ['Cancel', 'Save name']) {
    const button = await page.getByRole('button', { name }).boundingBox()
    if (button === null) throw new Error(`${name} has no box`)
    expect(button.y, `${name} is above the window`).toBeGreaterThanOrEqual(0)
    expect(button.y + button.height, `${name} is below the window`).toBeLessThanOrEqual(
      height + 1,
    )
  }
}

for (const { width, height } of WINDOWS) {
  test(`a tall dialog keeps its footer on screen at ${width} x ${height}, scrolled or not`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height })
    await openStory(page, TALL_STORY)

    const dialog = page.getByRole('dialog', { name: 'Rename group' })
    await expect(dialog).toBeVisible()
    const box = await dialog.boundingBox()
    if (box === null) throw new Error('the dialog has no box')
    expect(box.y, 'the dialog starts above the window').toBeGreaterThanOrEqual(-1)
    expect(box.y + box.height, 'the dialog runs below the window').toBeLessThanOrEqual(
      height + 1,
    )

    const { scrollHeight, clientHeight } = await dialog.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }))
    expect(scrollHeight, 'the dialog does not scroll').toBeGreaterThan(clientHeight)

    await footerButtonsAreInside(page, height)
    await dialog.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
    await footerButtonsAreInside(page, height)

    // Stuck or at rest, the footer ends at the dialog's own bottom edge.
    const footer = await dialog.locator('[data-slot=dialog-footer]').boundingBox()
    if (footer === null) throw new Error('the footer has no box')
    expect(Math.abs(box.y + box.height - 1 - (footer.y + footer.height))).toBeLessThan(2)
  })
}

for (const { width, height } of WINDOWS.slice(0, 2)) {
  test(`a two-line title ends clear of the corner close, left-aligned, at ${width} x ${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height })
    await openStory(page, TITLE_STORY)

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const { textRight, closeLeft, textAlign } = await dialog.evaluate((element) => {
      const title = element.querySelector('[data-slot=dialog-title]')
      const close = element.querySelector('[data-slot=dialog-close]')
      if (title === null || close === null) throw new Error('no title or close')
      const range = document.createRange()
      range.selectNodeContents(title)
      const lines = Array.from(range.getClientRects())
      return {
        textRight: Math.max(...lines.map((line) => line.right)),
        closeLeft: close.getBoundingClientRect().left,
        textAlign: getComputedStyle(title).textAlign,
      }
    })
    expect(closeLeft - textRight, 'the title runs into the close').toBeGreaterThanOrEqual(
      MIN_TITLE_GAP_PX,
    )
    expect(['start', 'left'], 'the title is not left-aligned').toContain(textAlign)
  })
}
