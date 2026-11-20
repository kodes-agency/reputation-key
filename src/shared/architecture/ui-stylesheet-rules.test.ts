// Rules in `src/styles.css` that the Storybook runner cannot measure, because it
// compiles no Tailwind and draws no real shell: the top bar's height token and
// the document gutter, the toaster's phone width, and the parts of the link
// layer `ui/link-ink.stories.tsx` does not reach (the hover ink, every opted-out
// slot, the sidebar look). Contrast is measured from the same sheet by each
// component's own test.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const STYLES = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf8')

type Block = Readonly<{ prelude: string; body: string }>

/** The blocks directly inside `css` (one level), with their braces matched. */
function topLevelBlocks(css: string): ReadonlyArray<Block> {
  const blocks: Block[] = []
  let depth = 0
  let preludeStart = 0
  let bodyStart = 0
  let prelude = ''
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index]
    if (char === '{') {
      if (depth === 0) {
        prelude = css.slice(preludeStart, index).trim()
        bodyStart = index + 1
      }
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        blocks.push({ prelude, body: css.slice(bodyStart, index) })
        preludeStart = index + 1
      }
    } else if (char === ';' && depth === 0) {
      preludeStart = index + 1
    }
  }
  return blocks
}

/** The stylesheet without comments, so a rule named in prose cannot satisfy a check. */
const SHEET = STYLES.replace(/\/\*[\s\S]*?\*\//gu, '')
const UNLAYERED = topLevelBlocks(SHEET).filter((block) => !block.prelude.startsWith('@'))
const BASE_LAYER = topLevelBlocks(SHEET)
  .filter((block) => block.prelude === '@layer base')
  .map((block) => block.body)
  .join('\n')
const LINK_DEFAULT = topLevelBlocks(BASE_LAYER).find((block) =>
  block.prelude.startsWith('a:not('),
)

describe('AppTopBar frame styles', () => {
  it('uses the one top-bar height token, shorter on a full-bleed surface', () => {
    expect(STYLES).toMatch(/--app-top-bar-height:\s*3\.25rem/u)
    expect(STYLES).toMatch(
      /\[data-full-bleed='true'\][^{]*\{[^}]*--app-top-bar-height:\s*2\.75rem/su,
    )
  })

  it('reserves the document gutter on every shell page, so crossings keep one width, without doubling a dialog lock', () => {
    expect(STYLES).toMatch(
      /:root:has\(\[data-frame\]\)\s*\{[^}]*scrollbar-gutter:\s*stable/su,
    )
    expect(STYLES).not.toMatch(/:root:has\(\[data-frame='page'\]\)/u)
    expect(STYLES).toMatch(
      /:root:has\(\[data-frame\]\) body\[data-scroll-locked\]\s*\{[^}]*margin-right:\s*0\s*!important/su,
    )
  })
})

describe('the toaster on a phone', () => {
  it('spans the window instead of hanging past its right edge', () => {
    expect(STYLES).toMatch(
      /\[data-sonner-toaster\]\[data-x-position\]\s*\{\s*left:\s*0;\s*right:\s*0;/u,
    )
  })
})

/** Anchors that own their ink, so the content-link default must not reach them. */
const OPTED_OUT_SLOTS = [
  'button',
  'badge',
  'sidebar-menu-button',
  'sidebar-menu-sub-button',
  'dropdown-menu-item',
  'breadcrumb-link',
] as const

describe('the global link default', () => {
  it('answers hover with the accent hover ink inside the same rule', () => {
    const hover = topLevelBlocks(LINK_DEFAULT?.body ?? '').find(
      (block) => block.prelude === '&:hover',
    )

    expect(hover?.body).toMatch(/color:\s*var\(--accent-hover\)/u)
  })

  it.each(OPTED_OUT_SLOTS)('leaves the %s anchor to its own component', (slot) => {
    expect(LINK_DEFAULT?.prelude).toContain(`[data-slot='${slot}']`)
  })
})

describe('the sidebar look', () => {
  it('is not restyled from global CSS, where it beat the primitive', () => {
    const restyled = [...UNLAYERED, ...topLevelBlocks(BASE_LAYER)]
      .map((block) => block.prelude)
      .filter((prelude) => !prelude.startsWith('a:not('))
      .filter((prelude) => prelude.includes('sidebar-menu'))

    expect(restyled).toEqual([])
  })
})
