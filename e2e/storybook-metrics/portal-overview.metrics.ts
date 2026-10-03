// The Portals overview's table against Storybook, where Tailwind is compiled.
// The Vitest story runner compiles none, so "hidden below 56 rem" and "the
// table does not scroll sideways" cannot be asserted there. Run with
// `pnpm test:storybook:metrics` (see `playwright.storybook.config.ts`).
//
// From a 56 rem container the overview is a table of six fixed-width columns
// beside the Portal's own; adding the five measure columns once pushed the
// fixed widths past the container's width between 56 and 62 rem, so the table
// scrolled sideways and the Share button and the row menu sat partly out of
// view. The widths below cover that band and the usual sizes around it.

import { expect, test } from '@playwright/test'
import { openStory } from './storybook-story'

const STORY = 'portal-portallistpage-results--default'

/** A little over 56 rem (the table's first width), then the common desktop sizes. */
const TABLE_WIDTHS = [900, 940, 960, 1024, 1100, 1200, 1280, 1440, 1920] as const
const CARD_WIDTHS = [320, 390, 768] as const

for (const width of TABLE_WIDTHS) {
  test(`the table fits a ${width}px window without scrolling sideways`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await openStory(page, STORY)

    const table = page.getByRole('table', { name: /portals at avela resort/i })
    await expect(
      table.getByRole('columnheader', { name: /qualified scans/i }),
    ).toBeVisible()
    const fit = await table.evaluate((element) => {
      const box = element.parentElement
      if (box === null) throw new Error('the table has no container')
      const tableBox = element.getBoundingClientRect()
      const container = box.getBoundingClientRect()
      return {
        scrollWidth: box.scrollWidth,
        clientWidth: box.clientWidth,
        tableRight: tableBox.right,
        containerRight: container.right,
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

    // The last things in a row, the Share link and the menu, are on screen.
    const row = table
      .getByRole('link', { name: 'Pool & Terrace' })
      .locator('xpath=ancestor::tr')
    await expect(row.getByRole('link', { name: /^Share / })).toBeInViewport({ ratio: 1 })
    await expect(row.getByRole('button', { name: /^More actions for / })).toBeInViewport({
      ratio: 1,
    })
  })
}

// A draft has no Share, and an archived Portal none either. Its row keeps the
// place, unseen, so Edit and the menu sit where they do in every other row and
// the actions read as one column rather than a ragged edge.
for (const [story, rowName] of [
  [STORY, 'Pool bar'],
  ['portal-portalgroup-grouppage--default', 'Pool bar'],
] as const) {
  test(`${story}: a draft's Edit and menu line up with the other rows' (1280px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await openStory(page, story)

    const table = page.getByRole('table', { name: /portals at avela resort/i })
    const left = async (role: 'link' | 'button', name: string): Promise<number> => {
      const box = await table.getByRole(role, { name }).boundingBox()
      if (box === null) throw new Error(`${name} has no box`)
      return Math.round(box.x)
    }
    const shared = await left('link', 'Edit Pool & Terrace')
    expect(await left('link', `Edit ${rowName}`), 'the draft row’s Edit').toBe(shared)
    expect(
      await left('button', `More actions for ${rowName}`),
      'the draft row’s menu',
    ).toBe(await left('button', 'More actions for Pool & Terrace'))
  })
}

for (const width of CARD_WIDTHS) {
  test(`a ${width}px window shows cards with one summary line, not measure columns`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await openStory(page, STORY)

    const table = page.getByRole('table', { name: /portals at avela resort/i })
    await expect(
      table.getByRole('columnheader', { name: /qualified scans/i }),
    ).toHaveCount(0)
    await expect(table.getByText(/\d+ qualified scans · /).first()).toBeVisible()
    const documentScrolls = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(documentScrolls, 'the document scrolls sideways').toBe(false)
  })
}
