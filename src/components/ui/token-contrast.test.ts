// Every colour a token pairs with its own fill reads at WCAG AA (4.5:1) in both
// themes, measured from the stylesheet itself rather than from a screenshot.
//
// This exists because `--destructive-foreground` was `oklch(0.58 0.22 25)` in
// light mode: the same value as `--destructive`, so the four buttons that
// spelled `bg-destructive text-destructive-foreground` printed red on red. A
// token that names "the text on this fill" is only worth having if the pair is
// readable, and nothing else would have caught the collision (axe needs a
// rendered button, and Storybook compiles the real stylesheet only for stories
// that happen to include one).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  composite,
  contrastRatio,
  readTokenBlock,
  resolveColour,
  type LinearRgb,
} from '#/shared/testing/oklch-contrast'
import { alertVariants } from './alert'
import { badgeVariants } from './badge'
import { buttonVariants } from './button'
import { Skeleton } from './skeleton'

const AA = 4.5

const css = readFileSync(resolve(__dirname, '../../styles.css'), 'utf8')
const light = readTokenBlock(css, ':root')
// `.dark` only overrides: a token it does not redeclare resolves from `:root`.
const dark = readTokenBlock(css, '.dark')
// `bg-*` utilities are named by the `@theme inline` block (`--color-border: var(--border)`).
const themeBlock = readTokenBlock(css, '@theme inline')

const THEMES = [
  { name: 'light', tokens: light, base: new Map<string, string>() },
  { name: 'dark', tokens: dark, base: light },
] as const

const colour = (theme: (typeof THEMES)[number], token: string): LinearRgb =>
  resolveColour(token, theme.tokens, theme.base)

/** A filled control and the text that sits on it. */
const ON_FILL: ReadonlyArray<readonly [fill: string, on: string]> = [
  ['--primary', '--primary-foreground'],
  ['--destructive', '--destructive-foreground'],
  ['--sidebar-primary', '--sidebar-primary-foreground'],
]

/** A surface and the body text that sits on it. */
const ON_SURFACE: ReadonlyArray<readonly [surface: string, on: string]> = [
  ['--background', '--foreground'],
  ['--card', '--card-foreground'],
  ['--popover', '--popover-foreground'],
  ['--secondary', '--secondary-foreground'],
  ['--muted', '--muted-foreground'],
  // `bg-accent` is mapped to `--accent-muted` in the theme block.
  ['--accent-muted', '--accent-foreground'],
  ['--sidebar', '--sidebar-foreground'],
  ['--sidebar-accent', '--sidebar-accent-foreground'],
]

describe.each(THEMES)('$name theme token pairs', (theme) => {
  it.each(ON_FILL)('%s carries %s at 4.5:1 or better', (fill, on) => {
    expect(contrastRatio(colour(theme, fill), colour(theme, on))).toBeGreaterThanOrEqual(
      AA,
    )
  })

  it.each(ON_SURFACE)('%s carries %s at 4.5:1 or better', (surface, on) => {
    expect(
      contrastRatio(colour(theme, surface), colour(theme, on)),
    ).toBeGreaterThanOrEqual(AA)
  })
})

// A loading block is decoration, so it owes no 3:1, but it must not vanish: in
// dark it drew `bg-accent` (the purple tint `--accent-muted`), which sat at
// 1.03:1 on a card, and the whole loading state read as an empty page. 1.15:1 is
// what the quietest light pairing (the old tint on `--background`, 1.17:1) held.
// Read the fill from the rendered Skeleton so this follows the component.
const SKELETON_MIN = 1.15
const SKELETON_SURFACES = [
  '--background',
  '--card',
  '--surface',
  '--surface-elevated',
  '--popover',
] as const

/** The `--token` a utility such as `bg-border` paints, by the stylesheet's `@theme` block. */
const skeletonFillToken = (): string => {
  const html = renderToStaticMarkup(createElement(Skeleton))
  const utility = /\bbg-([\w-]+)\b/.exec(html)?.[1]
  if (utility === undefined) throw new Error(`Skeleton paints no bg-* utility: ${html}`)
  const mapped = themeBlock.get(`--color-${utility}`)
  const reference = mapped === undefined ? null : /^var\((--[\w-]+)\)$/.exec(mapped)
  if (reference === null) throw new Error(`bg-${utility} is not a mapped colour`)
  return reference[1]!
}

describe.each(THEMES)('$name theme skeleton', (palette) => {
  it.each(SKELETON_SURFACES)('the Skeleton fill stays visible on %s', (surface) => {
    expect(
      contrastRatio(colour(palette, skeletonFillToken()), colour(palette, surface)),
    ).toBeGreaterThanOrEqual(SKELETON_MIN)
  })
})

describe('the destructive Button as rendered', () => {
  // The Button does not draw `--destructive` at full strength in dark mode: it
  // mixes it at some alpha over whatever the control sits on, with white text.
  // Read the recipe from the variant so this follows the component, then
  // measure that fill over every surface a confirm button lands on.
  const recipe = buttonVariants({ variant: 'destructive' }).split(/\s+/)
  const darkAlpha = recipe
    .map((utility) => /^dark:bg-destructive\/(\d+)$/.exec(utility))
    .find((match) => match !== null)?.[1]

  it('uses white text', () => {
    expect(recipe).toContain('text-white')
  })

  it.each(['--background', '--card', '--surface', '--surface-elevated'])(
    'reads at 4.5:1 in dark mode over %s',
    (surface) => {
      expect(darkAlpha).toBeDefined()
      const theme = THEMES[1]
      const fill = composite(
        colour(theme, '--destructive'),
        colour(theme, surface),
        Number(darkAlpha) / 100,
      )
      expect(contrastRatio(fill, [1, 1, 1])).toBeGreaterThanOrEqual(AA)
    },
  )

  it('reads at 4.5:1 in light mode', () => {
    expect(recipe).toContain('bg-destructive')
    expect(
      contrastRatio(colour(THEMES[0], '--destructive'), [1, 1, 1]),
    ).toBeGreaterThanOrEqual(AA)
  })
})

/**
 * The `--token` behind a colour utility such as `bg-positive-muted` or
 * `text-link`, read from the `@theme` block; null for a utility that is not a
 * colour (`text-sm`) or is not mapped.
 */
function tokenBehind(utility: string): string | null {
  const mapped = themeBlock.get(`--color-${utility}`)
  return mapped === undefined ? null : (/^var\((--[\w-]+)\)$/.exec(mapped)?.[1] ?? null)
}

/** The tokens a variant's classes paint with the given prefix (`bg` or `text`), unprefixed utilities only. */
function paintedWith(classes: string, prefix: 'bg' | 'text'): string[] {
  return classes.split(/\s+/).flatMap((utility) => {
    const name = new RegExp(`^${prefix}-([\\w-]+)$`).exec(utility)?.[1]
    const token = name === undefined ? null : tokenBehind(name)
    return token === null ? [] : [token]
  })
}

// The tone variants (SURF-05, COLL-05). Each draws its ink on its own tint, so
// the pair is read from the variant's classes rather than restated here: a tone
// whose ink or tint is changed to something that fails is caught in the theme
// it fails in, and a new tone is covered by adding its row.
const TONE_VARIANTS: ReadonlyArray<readonly [name: string, classes: string]> = [
  ['Alert destructive', alertVariants({ variant: 'destructive' })],
  ['Alert warning', alertVariants({ variant: 'warning' })],
  ['Alert success', alertVariants({ variant: 'success' })],
  ['Alert info', alertVariants({ variant: 'info' })],
  ['Badge positive', badgeVariants({ variant: 'positive' })],
  ['Badge warn', badgeVariants({ variant: 'warn' })],
  ['Badge negative', badgeVariants({ variant: 'negative' })],
  ['Badge neutral', badgeVariants({ variant: 'neutral' })],
]

/** The words an Alert prints besides its title: the quiet ink, and the page ink. */
const ALERT_BODY_INK = ['--muted-foreground', '--foreground'] as const

describe.each(THEMES)('$name theme tones', (theme) => {
  it.each(TONE_VARIANTS)(
    '%s reads its ink on its own tint at 4.5:1',
    (_name, classes) => {
      const tints = paintedWith(classes, 'bg')
      const inks = paintedWith(classes, 'text')

      expect(tints).toHaveLength(1)
      expect(inks).toHaveLength(1)
      expect(
        contrastRatio(colour(theme, tints[0]!), colour(theme, inks[0]!)),
      ).toBeGreaterThanOrEqual(AA)
    },
  )

  it.each(TONE_VARIANTS.filter(([name]) => name.startsWith('Alert')))(
    '%s reads its title and its description on its own tint at 4.5:1',
    (_name, classes) => {
      const tint = colour(theme, paintedWith(classes, 'bg')[0]!)

      for (const ink of ALERT_BODY_INK) {
        expect(contrastRatio(tint, colour(theme, ink))).toBeGreaterThanOrEqual(AA)
      }
    },
  )
})

// Red text: one token. `--destructive` is the fill-grade red (a button, a bar),
// and as text it reads 4.52:1 on the page but 4.26:1 on `--muted` and 4.07:1 on
// the tint of a failed notice in the light theme, so a field error in a muted
// well failed AA. `--negative` is the text-grade red and clears 4.5:1 on every
// surface a message lands on, in both themes. The fill-grade token is no longer
// used as text anywhere in the source (`tone-sources.test.ts` keeps it so).
const ERROR_TEXT_SURFACES = [
  '--background',
  '--card',
  '--surface',
  '--surface-elevated',
  '--popover',
  '--muted',
  '--secondary',
  '--destructive-muted',
  '--accent-muted',
] as const

describe.each(THEMES)('$name theme red text', (theme) => {
  it.each(ERROR_TEXT_SURFACES)('--negative reads on %s at 4.5:1 or better', (surface) => {
    expect(
      contrastRatio(colour(theme, '--negative'), colour(theme, surface)),
    ).toBeGreaterThanOrEqual(AA)
  })
})
