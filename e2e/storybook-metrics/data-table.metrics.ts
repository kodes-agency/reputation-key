// DataTable against Storybook, where Tailwind is compiled. The Vitest story runner
// compiles none, so "the header is not shown below the container width", "a row
// is a grid there and a table row from it" and "the frame is drawn" cannot be read
// back there (`src/components/ui/data-table.stories.tsx` covers what it can). Run
// with `pnpm test:storybook:metrics` (see `playwright.storybook.config.ts`).

import { expect, test, type Page } from '@playwright/test'
import { openStory } from './storybook-story'

const STORIES = {
  wide: 'patterns-data-table--wide',
  narrow: 'patterns-data-table--narrow',
  cardsWide: 'patterns-data-table--cards',
  cardsNarrow: 'patterns-data-table--cards-narrow',
  scroll: 'patterns-data-table--scroll',
} as const

const table = (page: Page) => page.getByRole('table', { name: /Members/ })

/** The frame: the element inside the container that measures it. */
const frame = (page: Page) => page.locator('div.\\@container > div').first()

test.describe('a table that stacks', () => {
  test('is a table with a header row from its container width', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await openStory(page, STORIES.wide)

    await expect(page.getByRole('columnheader', { name: 'Email' })).toBeVisible()
    const display = await table(page)
      .locator('tbody tr')
      .first()
      .evaluate((row) => getComputedStyle(row).display)
    expect(display).toBe('table-row')
  })

  test('hides the header row and stacks each row as a grid below it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await openStory(page, STORIES.narrow)

    await expect(page.getByRole('columnheader', { name: 'Email' })).toBeHidden()
    const display = await table(page)
      .locator('tbody tr')
      .first()
      .evaluate((row) => getComputedStyle(row).display)
    expect(display).toBe('grid')
  })

  test('decides by its own column, not by the window', async ({ page }) => {
    // A 22rem column in a desktop window stacks; the same table at a 56rem column
    // in a phone window would not fit the window but is still a table.
    await page.setViewportSize({ width: 1920, height: 800 })
    await openStory(page, STORIES.narrow)

    await expect(page.getByRole('columnheader', { name: 'Email' })).toBeHidden()
  })

  test('draws the frame at every width: a bordered card, rows divided inside it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    for (const story of [STORIES.wide, STORIES.narrow]) {
      await openStory(page, story)
      const style = await frame(page).evaluate((element) => {
        const computed = getComputedStyle(element)
        return {
          border: computed.borderTopWidth,
          radius: computed.borderTopLeftRadius,
          overflow: computed.overflow,
        }
      })
      expect(style.border, story).toBe('1px')
      expect(style.radius, story).not.toBe('0px')
      expect(style.overflow, story).toBe('hidden')
    }
  })
})

test.describe('a list of cards', () => {
  test('is framed only as a table, and each row is a card below it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })

    await openStory(page, STORIES.cardsNarrow)
    const frameBorder = await frame(page).evaluate(
      (element) => getComputedStyle(element).borderTopWidth,
    )
    expect(frameBorder).toBe('0px')
    const card = await table(page)
      .locator('tbody tr')
      .first()
      .evaluate((row) => {
        const computed = getComputedStyle(row)
        return { display: computed.display, border: computed.borderTopWidth }
      })
    expect(card).toEqual({ display: 'grid', border: '1px' })
    // The last card has its border too: the divider of a last table row is dropped
    // only when the rows are table rows.
    const last = await table(page)
      .locator('tbody tr')
      .last()
      .evaluate((row) => getComputedStyle(row).borderTopWidth)
    expect(last).toBe('1px')

    await openStory(page, STORIES.cardsWide)
    const wideBorder = await frame(page).evaluate(
      (element) => getComputedStyle(element).borderTopWidth,
    )
    expect(wideBorder).toBe('1px')
    const lastWide = await table(page)
      .locator('tbody tr')
      .last()
      .evaluate((row) => getComputedStyle(row).borderBottomWidth)
    expect(lastWide).toBe('0px')
  })
})

test.describe('a table that scrolls', () => {
  test('keeps its header and its columns in a narrow column, and scrolls sideways', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await openStory(page, STORIES.scroll)

    await expect(page.getByRole('columnheader', { name: 'Email' })).toBeVisible()
    const scrolls = await page
      .locator('[data-slot="table-container"]')
      .evaluate((element) => element.scrollWidth > element.clientWidth)
    expect(scrolls).toBe(true)
  })
})

test.describe('a stacked row’s actions menu', () => {
  // The trigger is a ghost icon button with air around its glyph (44px box below md,
  // 32px from it). Stacked, the cell pulls it out by that much, so the three dots
  // meet the right edge of the text beside them and sit on the first line's centre.
  for (const [name, viewport] of [
    ['a phone', { width: 390, height: 800 }],
    ['a desktop window', { width: 1280, height: 800 }],
  ] as const) {
    test(`is flush with the row's text edge on ${name}, and adds no height`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await openStory(page, STORIES.narrow)

      const row = table(page).locator('tbody tr').first()
      const cells = row.locator('td')
      const measured = await row.evaluate((element) => {
        const rect = (selector: string) =>
          element.querySelector(selector)?.getBoundingClientRect()
        const glyph = rect('button svg')
        const role = element.children[2]?.getBoundingClientRect()
        const first = element.children[0]?.getBoundingClientRect()
        const second = element.children[1]?.getBoundingClientRect()
        if (!glyph || !role || !first || !second) throw new Error('row cells not found')
        return {
          glyphRight: glyph.right,
          roleRight: role.right,
          glyphMiddle: glyph.top + glyph.height / 2,
          nameMiddle: first.top + first.height / 2,
          secondLineTop: second.top - element.getBoundingClientRect().top,
        }
      })

      expect(await cells.count()).toBe(4)
      expect(
        Math.abs(measured.glyphRight - measured.roleRight),
        'the dots against the text edge',
      ).toBeLessThanOrEqual(3)
      expect(
        Math.abs(measured.glyphMiddle - measured.nameMiddle),
        'the dots against the first line',
      ).toBeLessThanOrEqual(1)
      // The control's box overhangs the row's padding instead of growing the first
      // line: 14px of padding, a 28px first line and a 6px gap put the second at 48
      // (56 if the 44px trigger set the first line's height).
      expect(measured.secondLineTop, 'where the second line starts').toBeLessThanOrEqual(
        50,
      )
    })
  }
})
