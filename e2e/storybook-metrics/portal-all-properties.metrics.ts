// The All properties table against Storybook, where Tailwind is compiled (the
// Vitest story runner compiles none, so "hidden below 56 rem" and "the table
// does not scroll sideways" cannot be asserted there). Run with
// `pnpm test:storybook:metrics` (see `playwright.storybook.config.ts`).
//
// It shares its rows with the Portals page of one Property, so the same band
// that once scrolled sideways (56 to 62 rem, where the fixed column widths ran
// past the container) is checked here too, with a Property head row above the
// Portals: its subtotal cells and its menu must fit the same columns.

import { expect, test } from '@playwright/test'
import { openStory } from './storybook-story'

const STORY = 'portal-portalallpropertiespage--default'
const TABLE = { name: 'Portals at all properties' }

/** A little over 56 rem (the table's first width), then the common desktop sizes. */
const TABLE_WIDTHS = [900, 940, 960, 1024, 1100, 1200, 1280, 1440, 1920] as const
const CARD_WIDTHS = [320, 390, 768] as const

for (const width of TABLE_WIDTHS) {
  test(`the table fits a ${width}px window without scrolling sideways`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await openStory(page, STORY)

    const table = page.getByRole('table', TABLE)
    await expect(
      table.getByRole('columnheader', { name: /qualified scans/i }),
    ).toBeVisible()
    const fit = await table.evaluate((element) => {
      const box = element.parentElement
      if (box === null) throw new Error('the table has no container')
      return {
        scrollWidth: box.scrollWidth,
        clientWidth: box.clientWidth,
        tableRight: element.getBoundingClientRect().right,
        containerRight: box.getBoundingClientRect().right,
        documentScrolls:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }
    })
    expect(fit.scrollWidth, 'the container scrolls sideways').toBeLessThanOrEqual(
      fit.clientWidth,
    )
    expect(fit.tableRight, 'the table runs past its container').toBeLessThanOrEqual(
      fit.containerRight + 1,
    )
    expect(fit.documentScrolls, 'the document scrolls sideways').toBe(false)

    // A Property head's menu and a Portal's Share link are on screen.
    await expect(
      table.getByRole('button', { name: 'More actions for Avela Resort' }),
    ).toBeInViewport({ ratio: 1 })
    const row = table
      .getByRole('link', { name: 'Pool & Terrace' })
      .locator('xpath=ancestor::tr')
    await expect(row.getByRole('link', { name: /^Share / })).toBeInViewport({ ratio: 1 })
  })
}

for (const width of CARD_WIDTHS) {
  test(`a ${width}px window shows cards with one summary line, not measure columns`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await openStory(page, STORY)

    const table = page.getByRole('table', TABLE)
    await expect(
      table.getByRole('columnheader', { name: /qualified scans/i }),
    ).toHaveCount(0)
    // A Property's head carries its own summary line, a Portal's carries its own.
    await expect(table.getByText('1,607 scans · 4.4 ★ from 450')).toBeVisible()
    await expect(table.getByText(/\d+ qualified scans · /).first()).toBeVisible()
    const documentScrolls = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(documentScrolls, 'the document scrolls sideways').toBe(false)
  })
}

// A collapsed Property is its head row alone in its body, so the head is the body's
// last row. The cards' "last card keeps its border" rule once matched it and boxed
// the head in a square 1px border (it is not a card and has no radius).
for (const width of CARD_WIDTHS) {
  test(`a ${width}px window draws a collapsed Property's head with no box around it`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await openStory(page, STORY)

    const table = page.getByRole('table', TABLE)
    await table.getByRole('button', { name: 'Portals in Forma Kitchen' }).click()
    await expect(table.getByRole('link', { name: 'Dining room' })).toHaveCount(0)

    const widths = (row: ReturnType<typeof table.locator>) =>
      row.evaluate((element) => {
        const style = getComputedStyle(element)
        return [
          style.borderTopWidth,
          style.borderRightWidth,
          style.borderBottomWidth,
          style.borderLeftWidth,
        ]
      })
    const head = table
      .getByRole('button', { name: 'Portals in Forma Kitchen' })
      .locator('xpath=ancestor::tr')
    expect(await widths(head), 'the collapsed head row’s borders').toEqual([
      '0px',
      '0px',
      '0px',
      '0px',
    ])
  })
}
