// The History tab against Storybook, where Tailwind is compiled. The Vitest
// story runner compiles none, so "the rail sits beside the ledger from 64 rem",
// "nothing scrolls sideways" and "a version's actions are reachable without
// hover" cannot be asserted there. Run with `pnpm test:storybook:metrics`.

import { expect, test, type Page } from '@playwright/test'
import { openStory } from './storybook-story'

const STORY = 'portal-portalhistory--all'
const OPEN_STORY = 'portal-portalhistory--make-live-again-open'
const VIEW_STORY = 'portal-portalhistory--view-version-with-page'
const EARLIER_DESIGN_STORY =
  'portal-portalhistorytab--view-of-an-earlier-design-falls-back-to-words'

/** The dialog's own padding is at least this much: nothing of it may touch the edge. */
const MIN_DIALOG_MARGIN = 12
/** One rem is 16 px; the words column is never narrower than 16 rem. */
const WORDS_COLUMN_MIN = 256

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

for (const width of [320, 390, 768, 1024, 1440] as const) {
  test(`"View" shows the version's page in a ${width}px window and its buttons stay reachable`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    await openStory(page, VIEW_STORY)

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const phone = dialog.getByRole('region', {
      name: /^Preview of the guest page: Version 4/,
    })
    await expect(phone).toBeVisible()
    // The bezel is the phone's outer frame: two boxes up from the scrolling page.
    const bezel = phone.locator('xpath=../..')
    const [panel, bezelBox] = await Promise.all([
      dialog.boundingBox(),
      bezel.boundingBox(),
    ])
    if (panel === null || bezelBox === null)
      throw new Error('the dialog or the phone frame has no box')
    // The frame sits inside the dialog's padding, never over it.
    expect(
      bezelBox.x - panel.x,
      'the phone frame runs over the dialog padding on the left',
    ).toBeGreaterThanOrEqual(MIN_DIALOG_MARGIN)
    expect(
      panel.x + panel.width - (bezelBox.x + bezelBox.width),
      'the phone frame runs over the dialog padding on the right',
    ).toBeGreaterThanOrEqual(MIN_DIALOG_MARGIN)
    await expectDialogInsideWindow(page, panel, width)
    await expect(
      dialog.getByRole('button', { name: 'Close', exact: true }).first(),
    ).toBeVisible()
    await expectNothingScrollsSideways(page)
  })
}

// A version from before the new design has only its words: they must be readable.
for (const width of [320, 390, 768, 1024, 1440] as const) {
  test(`"View" of an earlier design reads its words in a ${width}px window`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    await openStory(page, EARLIER_DESIGN_STORY)

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const heading = dialog.getByRole('heading', { name: 'What it lists' })
    await expect(heading).toBeVisible()
    const [panel, headingBox] = await Promise.all([
      dialog.boundingBox(),
      heading.boundingBox(),
    ])
    if (panel === null || headingBox === null)
      throw new Error('the dialog or the words have no box')
    // Where the window is too narrow for 16rem, the column is the dialog's whole content box.
    expect(headingBox.width, 'the words column is squeezed').toBeGreaterThanOrEqual(
      Math.min(WORDS_COLUMN_MIN, panel.width - 4 * MIN_DIALOG_MARGIN),
    )
    await expectDialogInsideWindow(page, panel, width)
    await expectNothingScrollsSideways(page)
  })
}

async function expectDialogInsideWindow(
  page: Page,
  panel: { x: number; width: number; y: number; height: number },
  width: number,
): Promise<void> {
  // A fixed dialog leaves a 1rem margin from the window at every width.
  expect(panel.x, 'the dialog touches the left edge').toBeGreaterThanOrEqual(15)
  expect(
    width - (panel.x + panel.width),
    'the dialog touches the right edge',
  ).toBeGreaterThanOrEqual(15)
  expect(panel.y, 'the dialog starts above the window').toBeGreaterThanOrEqual(0)
  expect(panel.y + panel.height, 'the dialog runs below the window').toBeLessThanOrEqual(
    800,
  )
  // A fixed dialog never makes the document scroll: its own content may not scroll sideways.
  const dialogScrolls = await page
    .getByRole('dialog')
    .evaluate((node) => node.scrollWidth > node.clientWidth)
  expect(dialogScrolls, 'the dialog scrolls sideways').toBe(false)
}

async function expectNothingScrollsSideways(page: Page): Promise<void> {
  const documentScrolls = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(documentScrolls, 'the document scrolls sideways').toBe(false)
}
