// Review & publish against Storybook, where Tailwind is compiled (board 05).
// The language rows hold a name, a coverage line and, for AI drafts, a third
// piece of text; on a 320 px phone the name once shared its line with the
// draft note and the two were drawn on top of each other. Run with
// `pnpm test:storybook:metrics`.

import { expect, test } from '@playwright/test'
import { openStory } from './storybook-story'

const STORY = 'portal-portalreviewpage--one-star-and-five-star-pair'

for (const width of [320, 390, 768, 1440] as const) {
  test(`the language rows keep their texts apart in a ${width}px window`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await openStory(page, STORY)

    const rows = page.getByRole('region', { name: 'Languages' }).getByRole('listitem')
    expect(await rows.count()).toBeGreaterThan(0)
    for (const row of await rows.all()) {
      const boxes = await row
        .locator(':scope > span:not([aria-hidden])')
        .evaluateAll((spans) =>
          spans.map((span) => {
            const box = span.getBoundingClientRect()
            return {
              text: span.textContent ?? '',
              spills: span.scrollWidth > span.clientWidth + 1,
              ...box.toJSON(),
            }
          }),
        )
      for (const box of boxes) {
        // A word wider than a squeezed box runs out of it and over its neighbour.
        expect(box.spills, `"${box.text}" runs out of its own box`).toBe(false)
      }
      for (const [index, a] of boxes.entries()) {
        for (const b of boxes.slice(index + 1)) {
          const overlapsAcross = a.left < b.right && b.left < a.right
          const overlapsDown = a.top < b.bottom && b.top < a.bottom
          expect(
            overlapsAcross && overlapsDown,
            `"${a.text}" is drawn over "${b.text}"`,
          ).toBe(false)
        }
      }
    }
    const documentScrolls = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(documentScrolls, 'the document scrolls sideways').toBe(false)
  })
}
