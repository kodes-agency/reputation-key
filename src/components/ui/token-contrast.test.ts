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
import { describe, expect, it } from 'vitest'
import {
  composite,
  contrastRatio,
  readTokenBlock,
  resolveColour,
  type LinearRgb,
} from '#/shared/testing/oklch-contrast'
import { buttonVariants } from './button'

const AA = 4.5

const css = readFileSync(resolve(__dirname, '../../styles.css'), 'utf8')
const light = readTokenBlock(css, ':root')
// `.dark` only overrides: a token it does not redeclare resolves from `:root`.
const dark = readTokenBlock(css, '.dark')

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
