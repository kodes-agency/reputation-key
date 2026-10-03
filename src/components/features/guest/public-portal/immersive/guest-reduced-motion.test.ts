// The browser gate (`e2e/storybook-metrics/guest-immersive.metrics.ts`) proves
// the page is still under `prefers-reduced-motion: reduce`, but the app's
// global rule in `src/styles.css` floors every duration to 0.01 ms with
// `!important`, so it passes whatever the guest stylesheets do. This is the
// guest page's own half: each of its stylesheets must answer the preference
// itself, so the page stays still if that global rule is ever narrowed.

import { describe, expect, it } from 'vitest'
import { IMMERSIVE_CHROME_CSS } from './immersive-chrome-styles'
import { IMMERSIVE_FOOTER_CSS } from './immersive-footer-styles'
import { IMMERSIVE_RESPONSE_CSS } from './immersive-response-styles'
import { IMMERSIVE_SECTION_CSS } from './immersive-section-styles'
import { IMMERSIVE_CSS } from './immersive-styles'
import { LINKTREE_CSS } from './linktree-styles'

const STYLESHEETS = {
  'immersive-styles': IMMERSIVE_CSS,
  'immersive-chrome-styles': IMMERSIVE_CHROME_CSS,
  'immersive-footer-styles': IMMERSIVE_FOOTER_CSS,
  'immersive-response-styles': IMMERSIVE_RESPONSE_CSS,
  'immersive-section-styles': IMMERSIVE_SECTION_CSS,
  'linktree-styles': LINKTREE_CSS,
} as const

type MediaBlock = Readonly<{ condition: string; body: string }>

/** Every `@media (...) { ... }` block of a stylesheet, with its braces matched. */
function mediaBlocks(css: string): ReadonlyArray<MediaBlock> {
  const blocks: MediaBlock[] = []
  for (const start of css.matchAll(/@media\s*([^{]*)\{/gu)) {
    const opened = (start.index ?? 0) + start[0].length
    let depth = 1
    let end = opened
    while (end < css.length && depth > 0) {
      if (css[end] === '{') depth += 1
      if (css[end] === '}') depth -= 1
      end += 1
    }
    blocks.push({ condition: (start[1] ?? '').trim(), body: css.slice(opened, end - 1) })
  }
  return blocks
}

/** The stylesheet with the blocks that answer, or wait on, the preference removed. */
function withoutMotionPreferenceBlocks(css: string): string {
  return mediaBlocks(css)
    .filter((block) => block.condition.includes('prefers-reduced-motion'))
    .reduce((rest, block) => rest.replace(block.body, ''), css)
}

describe.each(Object.entries(STYLESHEETS))('%s under reduced motion', (_name, css) => {
  const reduced = mediaBlocks(css)
    .filter((block) => block.condition.includes('prefers-reduced-motion: reduce'))
    .map((block) => block.body)
    .join('\n')
  const ungated = withoutMotionPreferenceBlocks(css)

  it('turns its own transitions off', () => {
    const declares = /(^|[\s;{])transition:\s*(?!none)/mu.test(ungated)
    if (!declares) return
    expect(reduced).toMatch(/transition:\s*none/u)
  })

  it('turns its own animations off', () => {
    const declares = /(^|[\s;{])animation:\s*(?!none)/mu.test(ungated)
    if (!declares) return
    expect(reduced).toMatch(/animation:\s*none/u)
  })
})

describe('the guest stylesheets as a whole', () => {
  it('declare motion somewhere, so the checks above are not vacuous', () => {
    const declared = Object.values(STYLESHEETS).filter((css) =>
      /(^|[\s;{])(transition|animation):\s*(?!none)/mu.test(css),
    )
    expect(declared.length).toBeGreaterThanOrEqual(4)
  })

  it('only start the sheet animation when motion is allowed', () => {
    expect(withoutMotionPreferenceBlocks(IMMERSIVE_CHROME_CSS)).not.toMatch(
      /(^|[\s;{])animation:\s*(?!none)/mu,
    )
  })
})
