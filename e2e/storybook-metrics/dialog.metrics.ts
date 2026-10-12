// The Dialog primitive against Storybook, where Tailwind is compiled (the Vitest
// story runner compiles none, so what is on screen cannot be asserted there).
// Run with `pnpm test:storybook:metrics` (see `playwright.storybook.config.ts`).
//
// `Patterns/Dialog` `TallContentScrolls` opens a dialog with forty lines. Whatever
// the window, the dialog stays inside it, its body scrolls, and the footer is
// pinned: Cancel and the primary action are on screen before the person has
// scrolled anywhere, and still there after they have scrolled to the end. The
// two-line title of `TitleLeavesRoomForTheCloseInAForm` ends clear of the corner
// close, and the header is left-aligned at every width. Whatever its size, a
// dialog keeps a 1rem margin from the window on both sides: a bare `sm:max-w-4xl`
// is 56rem even in a 768px window, which put the History "View" dialog flush with
// the left edge, so each size is measured from a phone to a desktop.

import { expect, test, type Locator, type Page } from '@playwright/test'
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

/** The margin a fixed dialog leaves from the window on each side (1rem). */
const MARGIN_PX = 16

/** Each `size`'s own width, in px (24, 32, 42 and 56rem). */
const SIZES = [
  { story: 'patterns-dialog--small', name: 'sm', width: 384 },
  { story: 'patterns-dialog--medium', name: 'md', width: 512 },
  { story: 'patterns-dialog--large', name: 'lg', width: 672 },
  { story: 'patterns-dialog--extra-large', name: 'xl', width: 896 },
] as const
const CONFIRMATION_STORY = 'patterns-confirmation-dialog--tall-body-scrolls'
const CONFIRMATION_WIDTH = 512
/** A phone, a window wider than a short list, the `sm` breakpoint, a tablet, a desktop. */
const SIZE_WINDOWS = [320, 500, 640, 768, 1440] as const

/** What a size should measure in a window `width` px wide: its own, or the window less the margins. */
function expectedWidth(size: number, width: number): number {
  return Math.min(size, width - 2 * MARGIN_PX)
}

async function expectWidthAndMargins(
  dialog: Locator,
  size: number,
  width: number,
): Promise<void> {
  await expect(dialog).toBeVisible()
  const box = await dialog.boundingBox()
  if (box === null) throw new Error('the dialog has no box')
  expect(box.width, 'the dialog is not its size capped at the window').toBeCloseTo(
    expectedWidth(size, width),
    0,
  )
  expect(box.x, 'the dialog touches the left edge').toBeGreaterThanOrEqual(MARGIN_PX - 1)
  expect(
    width - (box.x + box.width),
    'the dialog touches the right edge',
  ).toBeGreaterThanOrEqual(MARGIN_PX - 1)
}

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

for (const { story, name, width: size } of SIZES) {
  for (const width of SIZE_WINDOWS) {
    test(`a ${name} dialog is ${expectedWidth(size, width)}px with a 1rem margin in a ${width}px window`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      await openStory(page, story)

      await expectWidthAndMargins(page.getByRole('dialog'), size, width)
    })
  }
}

// A confirmation is an AlertDialog, a second primitive with its own width classes.
for (const width of [320, 375, 768] as const) {
  test(`a confirmation keeps a 1rem margin in a ${width}px window`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await openStory(page, CONFIRMATION_STORY)

    await expectWidthAndMargins(page.getByRole('alertdialog'), CONFIRMATION_WIDTH, width)
  })
}
