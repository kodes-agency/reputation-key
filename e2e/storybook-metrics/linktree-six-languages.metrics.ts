// A Portal in all six guest languages in the Linktree editor, against Storybook,
// where Tailwind is compiled (the Vitest story runner compiles none, so "does
// not scroll sideways" cannot be asserted there). Five tabs read "XX missing",
// which is about 500 px of segments on one line. Run with
// `pnpm test:storybook:metrics` (see `playwright.storybook.config.ts`).

import { expect, test } from '@playwright/test'
import { openStory } from './storybook-story'

const STORY = 'portal-linktree--six-languages-wrap-the-language-tabs'
const GROUPS = ['Title language', 'Label language'] as const

// A phone, and the side panel the editor sits in beside the preview.
for (const width of [375, 900] as const) {
  test(`six language tabs stay inside a ${width}px window`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await openStory(page, STORY)

    for (const name of GROUPS) {
      const group = page.getByRole('radiogroup', { name })
      await expect(group.getByRole('radio')).toHaveCount(6)
      const box = await group.boundingBox()
      expect(box, `${name} is drawn`).not.toBeNull()
      expect(
        (box?.x ?? 0) + (box?.width ?? 0),
        `${name} runs past the window`,
      ).toBeLessThanOrEqual(width)
      // Each segment is on screen, not clipped by a scrolling parent.
      for (const radio of await group.getByRole('radio').all())
        await expect(radio).toBeInViewport({ ratio: 1 })
    }
    const documentScrolls = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(documentScrolls, 'the document scrolls sideways').toBe(false)
  })
}
