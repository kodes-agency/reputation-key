// The link layer (UI consistency scan: FRAME-06, NAV-02, ACT-19).
//
// `styles.css` gives every plain `<a>` the accent ink. That default used to sit
// OUTSIDE every cascade layer, where it beat every Tailwind utility on every
// anchor it matched, so a nav, breadcrumb or menu item could not choose its own
// ink and about eighteen call sites pinned it back with `!`. The default now
// lives in `@layer base`: utilities win by layer order, and the anchors that
// belong to a component with its own ink opt out by `data-slot`.
//
// These checks read the sources, not a browser: they pin the structure that
// makes the cascade work. The cascade itself is exercised in a real browser by
// `link-ink.stories.tsx` (Patterns/Link ink).

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const STYLES = readFileSync(join(ROOT, 'src/styles.css'), 'utf8')

/** The stylesheet without comments, so a rule named in prose cannot satisfy a check. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//gu, '')
}

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

const SHEET = stripComments(STYLES)
const UNLAYERED = topLevelBlocks(SHEET).filter((block) => !block.prelude.startsWith('@'))
const BASE_LAYER = topLevelBlocks(SHEET)
  .filter((block) => block.prelude === '@layer base')
  .map((block) => block.body)
  .join('\n')

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
  it('is not an unlayered rule, which would beat every utility on every anchor', () => {
    const anchorRules = UNLAYERED.filter((block) =>
      /(^|[\s,>+~])a([\s,:[.]|$)/u.test(block.prelude),
    )

    expect(anchorRules.map((block) => block.prelude)).toEqual([])
  })

  it('sits in @layer base and keeps the accent ink for content links', () => {
    const rule = topLevelBlocks(BASE_LAYER).find((block) =>
      block.prelude.startsWith('a:not('),
    )

    expect(rule).toBeDefined()
    expect(rule?.body).toMatch(/color:\s*var\(--accent\)/u)
    expect(rule?.body).toMatch(/text-decoration:\s*none/u)
  })

  it('answers hover with the accent hover ink inside the same rule', () => {
    const rule = topLevelBlocks(BASE_LAYER).find((block) =>
      block.prelude.startsWith('a:not('),
    )
    const hover = topLevelBlocks(rule?.body ?? '').find(
      (block) => block.prelude === '&:hover',
    )

    expect(hover?.body).toMatch(/color:\s*var\(--accent-hover\)/u)
  })

  it.each(OPTED_OUT_SLOTS)('leaves the %s anchor to its own component', (slot) => {
    const rule = topLevelBlocks(BASE_LAYER).find((block) =>
      block.prelude.startsWith('a:not('),
    )

    expect(rule?.prelude).toContain(`[data-slot='${slot}']`)
  })
})

describe('the sidebar look', () => {
  const sidebar = readFileSync(join(ROOT, 'src/components/ui/sidebar.tsx'), 'utf8')

  it('is not restyled from global CSS, where it beat the primitive', () => {
    const restyled = [...UNLAYERED, ...topLevelBlocks(BASE_LAYER)]
      .map((block) => block.prelude)
      .filter((prelude) => !prelude.startsWith('a:not('))
      .filter((prelude) => prelude.includes('sidebar-menu'))

    expect(restyled).toEqual([])
  })

  it('lives in the primitive: accent-muted fill, semibold label, accent icon', () => {
    for (const className of [
      'data-[active=true]:bg-sidebar-accent',
      'data-[active=true]:font-semibold',
      '[&_svg]:text-(--accent)',
      'text-sidebar-foreground',
    ]) {
      expect(sidebar).toContain(className)
    }
  })
})

// An `!` on an ink utility is the symptom this layer removes. `eslint.config.js`
// cannot carry a rule for it yet (the owner applies that patch), so this test is
// the guard: no component may pin colour or decoration with an important
// modifier. The one exception is an icon inside a destructive menu item, which
// fights a sibling arbitrary-variant rule and has nothing to do with links.
const PINNED_INK_ALLOWED = new Set(['src/components/ui/dropdown-menu.tsx'])

const IMPORTANT_INK =
  /(?:^|[\s"'`:])(?:!(?:text|decoration)-[\w()/.%-]+|!(?:no-)?underline\b|(?:text|decoration)-[\w()/.%-]+!|(?:no-)?underline!)(?=[\s"'`)\]},]|$)/mu

function sourceFiles(dir: string): ReadonlyArray<string> {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/u.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !/\.(test|stories)\.tsx?$/u.test(file))
}

function codeLines(file: string): ReadonlyArray<string> {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/u.test(line))
}

describe('ink pins', () => {
  it('no component pins colour or decoration with an important modifier', () => {
    const offenders = sourceFiles(join(ROOT, 'src'))
      .map((file) => relative(ROOT, file))
      .filter((file) => !PINNED_INK_ALLOWED.has(file))
      .filter((file) =>
        codeLines(join(ROOT, file)).some((line) => IMPORTANT_INK.test(line)),
      )

    expect(offenders).toEqual([])
  })

  it('still recognises the pins it exists to catch', () => {
    for (const pinned of [
      'text-foreground!',
      'hover:text-foreground!',
      'text-(--accent)!',
      '!text-muted-foreground',
      'underline!',
      'decoration-dotted!',
      'className="min-h-11 text-foreground! md:min-h-8"',
    ]) {
      expect(IMPORTANT_INK.test(pinned)).toBe(true)
    }
    for (const fine of [
      'text-foreground',
      'hover:text-foreground',
      'size-8!',
      'group-data-[collapsible=icon]:p-2!',
      'underline-offset-4',
    ]) {
      expect(IMPORTANT_INK.test(fine)).toBe(false)
    }
  })
})
