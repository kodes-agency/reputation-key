// The live line of a Goals row against Storybook, where Tailwind is compiled. The
// Vitest story runner compiles none, so "the placeholder a row shows while its
// month is read is exactly as high as the line that replaces it" cannot be read
// back there (`src/components/goals/goal-live-line.stories.tsx` covers what it
// can). A placeholder a pixel short pushes every row below it down when the
// figure arrives, which is the layout shift it exists to prevent. Run with
// `pnpm test:storybook:metrics` (see `playwright.storybook.config.ts`).
//
// The stories measured here sit in a full-width container. A Goals row on a
// phone is narrower: at a 375 px screen its cell is about 230 px (page gutter,
// frame, row padding and the status column come off), and the count line with
// its "below pace" note needs about 270 px, so there that line wraps to two
// lines (measured 2026-10-14 in a replica row: 20 px without the note, 40 px
// with it; it fits from about 440 px, and the "More ratings needed" line of an
// average already wraps there). The placeholder is one line, so a below-pace row
// on a narrow phone moves the rows under it by one line when its figure arrives.

import { expect, test, type Page } from '@playwright/test'
import { openStory } from './storybook-story'

const STORIES = {
  count: 'goals-goalliveline--pending-keeps-the-room-of-a-count',
  countBelowPace: 'goals-goalliveline--pending-keeps-the-room-of-a-count-below-pace',
  line: 'goals-goalliveline--pending-keeps-the-room-of-a-line',
} as const

const VIEWPORTS = [
  { name: 'a desktop', width: 1280, height: 800 },
  { name: 'a phone', width: 375, height: 800 },
] as const

/** The room each slot takes, margin included, as the rows below feel it. */
async function slotRoom(page: Page): Promise<{ pending: number; loaded: number }> {
  return page.evaluate(() => {
    const room = (slot: string): number => {
      const element = document.querySelector(`[data-slot="${slot}"]`)
      if (!element) throw new Error(`No ${slot} drawn`)
      const margin = Number.parseFloat(getComputedStyle(element).marginTop)
      return element.getBoundingClientRect().height + margin
    }
    return { pending: room('goal-live-line-pending'), loaded: room('goal-live-line') }
  })
}

for (const viewport of VIEWPORTS) {
  test.describe(`on ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test('a count keeps the room of its line and its bar', async ({ page }) => {
      await openStory(page, STORIES.count)

      const { pending, loaded } = await slotRoom(page)

      expect(pending).toBeGreaterThan(0)
      expect(pending).toBe(loaded)
    })

    test('a count below pace keeps the same room where its line fits', async ({
      page,
    }) => {
      await openStory(page, STORIES.countBelowPace)

      const { pending, loaded } = await slotRoom(page)

      expect(pending).toBeGreaterThan(0)
      expect(pending).toBe(loaded)
    })

    test('an average or several subjects keep the room of a line', async ({ page }) => {
      await openStory(page, STORIES.line)

      const { pending, loaded } = await slotRoom(page)

      expect(pending).toBeGreaterThan(0)
      expect(pending).toBe(loaded)
    })
  })
}
