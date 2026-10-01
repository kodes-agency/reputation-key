// The batch "Review & publish" dialog of the Property look page against
// Storybook, where Tailwind is compiled (the Vitest story runner compiles none,
// so "fits the window" cannot be asserted there). Run with
// `pnpm test:storybook:metrics` (see `playwright.storybook.config.ts`).
//
// The story opens the dialog over the five live portals of "Avela Resort". At a
// phone's width and height the dialog must sit inside the window, nothing may
// scroll sideways, and both footer buttons must be on screen: a manager who
// cannot reach "Publish" has reviewed for nothing. A long list scrolls inside
// the dialog, not the dialog out of the window.

import { expect, test } from '@playwright/test'
import { openStory } from './storybook-story'

const STORY = 'portal-propertylook-batchpublish--review-lists-each-live-portal'

const WINDOWS = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
] as const

for (const { width, height } of WINDOWS) {
  test(`the review dialog fits a ${width} x ${height} window and its buttons are reachable`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height })
    await openStory(page, STORY)

    const dialog = page.getByRole('dialog', { name: 'Review & publish 5 portals' })
    await expect(dialog).toBeVisible()
    const box = await dialog.boundingBox()
    if (box === null) throw new Error('the dialog has no box')
    expect(box.x, 'the dialog starts left of the window').toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, 'the dialog runs past the window').toBeLessThanOrEqual(
      width + 1,
    )
    expect(box.y, 'the dialog starts above the window').toBeGreaterThanOrEqual(-1)
    expect(box.y + box.height, 'the dialog runs below the window').toBeLessThanOrEqual(
      height + 1,
    )

    const scrollsSideways = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(scrollsSideways, 'the document scrolls sideways').toBe(false)

    for (const name of ['Cancel', 'Publish 3 portals']) {
      const button = await dialog.getByRole('button', { name }).boundingBox()
      if (button === null) throw new Error(`${name} has no box`)
      expect(button.y + button.height, `${name} is below the window`).toBeLessThanOrEqual(
        height + 1,
      )
      expect(button.x + button.width, `${name} runs past the window`).toBeLessThanOrEqual(
        width + 1,
      )
    }
  })
}
