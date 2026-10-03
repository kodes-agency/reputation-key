// A tile's caption and a MetricDelta set in a sentence, against Storybook, where
// Tailwind is compiled (the Vitest story runner compiles none, so neither rule can
// be read back there). Run with `pnpm test:storybook:metrics` (see
// `playwright.storybook.config.ts`).
//
// Two things the visual QA pass found on the Overview tiles (UI consistency scan,
// stage 3):
//
//   - the dot between "in the last 30 days" and the change was typed into the
//     text, so when the change wrapped onto its own line the dot was left
//     dangling at the end of the line above. `TileCaption` keeps the dot in the
//     change's own left lane and clips it away when that lane starts a line;
//   - the change sat about 2px above the words around it, because the box took
//     its baseline from the arrow's bottom edge instead of from its words.
//
// Both are read from boxes, not from pixels: a text node's range rectangle has
// the same top and bottom in the same font on the same baseline, and a clipped
// dot lies wholly left of the clip's edge.

import { expect, test, type Page } from '@playwright/test'
import { openStory } from './storybook-story'

const ROOMY = 'property-overviewtilecaption--shares-a-line'
const NARROW = 'property-overviewtilecaption--drops-to-its-own-line'
const SENTENCE = 'patterns-metric-delta--in-a-sentence'

/** Half a pixel: a range rectangle is a fractional box, and a baseline is not. */
const BASELINE_TOLERANCE_PX = 0.5

type Box = Readonly<{ top: number; bottom: number; left: number; right: number }>

type CaptionBoxes = Readonly<{
  clip: Box
  captionPart: Box
  detailPart: Box
  dot: Box
}>

type SentenceBoxes = Readonly<{ sentenceText: Box; deltaText: Box }>

/** Reads the caption's clip, its two parts and its dot, in page coordinates. */
async function captionBoxes(page: Page): Promise<CaptionBoxes> {
  return page.evaluate(() => {
    const caption = document.querySelector<HTMLElement>('[data-slot="tile-caption"]')!
    const parts = caption.firstElementChild!.children
    const box = (rect: DOMRect) => ({
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
    })
    return {
      clip: box(caption.getBoundingClientRect()),
      captionPart: box(parts[0]!.getBoundingClientRect()),
      detailPart: box(parts[1]!.getBoundingClientRect()),
      dot: box(
        caption
          .querySelector<HTMLElement>('[aria-hidden="true"]')!
          .getBoundingClientRect(),
      ),
    }
  })
}

/** Reads the sentence's own words and the change's words, in page coordinates. */
async function sentenceBoxes(page: Page): Promise<SentenceBoxes> {
  return page.evaluate(() => {
    const sentence = document.querySelector<HTMLElement>('#storybook-root p')!
    const delta = sentence.querySelector<HTMLElement>('[data-slot="metric-delta"]')!
    const textBox = (node: Node) => {
      const range = document.createRange()
      range.selectNodeContents(node)
      const rect = range.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
    }
    return {
      sentenceText: textBox(sentence.firstChild!),
      deltaText: textBox(delta.children[1]!.lastChild!),
    }
  })
}

test.describe('the tile caption', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
  })

  test('puts the dot between the caption and the change when they share a line', async ({
    page,
  }) => {
    await openStory(page, ROOMY)
    const { clip, captionPart, detailPart, dot } = await captionBoxes(page)

    expect(detailPart.top).toBe(captionPart.top)
    expect(dot.left).toBeGreaterThanOrEqual(clip.left)
    expect(dot.left).toBeGreaterThanOrEqual(captionPart.right)
    expect(dot.right).toBeLessThan(detailPart.right)
  })

  test('leaves no dot behind when the change drops to its own line', async ({ page }) => {
    await openStory(page, NARROW)
    const { clip, captionPart, detailPart, dot } = await captionBoxes(page)

    expect(detailPart.top).toBeGreaterThan(captionPart.top)
    expect(dot.right).toBeLessThanOrEqual(clip.left)
  })
})

test('a change inside a sentence sits on the sentence baseline', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await openStory(page, SENTENCE)
  const { sentenceText, deltaText } = await sentenceBoxes(page)

  // On one line, or the comparison would be of two lines and mean nothing.
  expect(deltaText.top).toBeLessThan(sentenceText.bottom)
  expect(Math.abs(deltaText.bottom - sentenceText.bottom)).toBeLessThan(
    BASELINE_TOLERANCE_PX,
  )
})
