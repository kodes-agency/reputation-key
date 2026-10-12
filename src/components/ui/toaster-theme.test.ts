// The Toaster paints from the app's tokens, not from Sonner's own palette.
//
// Sonner 2 colours a typed toast from hsl() literals keyed on its `theme` prop
// (light by default), so a success toast on the dark UI was a pastel light card
// that ignored `.dark` and `--success`. These cases pin what replaces it: every
// typed colour is a token reference, and the text on each tinted surface reads
// at 4.5:1 in both themes. The pairs are read back from the style object the
// Toaster hands Sonner, so the proof follows the code and not a second table.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  contrastRatio,
  readTokenBlock,
  resolveColour,
  type LinearRgb,
} from '#/shared/testing/oklch-contrast'
import { TOASTER_STYLE } from './toaster-theme'
import { TONE_INK, TONE_SURFACE } from './tone'

const AA = 4.5
const TONES = ['success', 'info', 'warning', 'error'] as const
const style = TOASTER_STYLE as Record<string, string>

const css = readFileSync(resolve(__dirname, '../../styles.css'), 'utf8')
const light = readTokenBlock(css, ':root')
const dark = readTokenBlock(css, '.dark')
const THEMES = [
  { name: 'light', tokens: light, base: new Map<string, string>() },
  { name: 'dark', tokens: dark, base: light },
] as const

const colour = (theme: (typeof THEMES)[number], token: string): LinearRgb =>
  resolveColour(token, theme.tokens, theme.base)

/** The `--token` a plain `var(--token)` value names. */
const tokenOf = (value: string | undefined): string => {
  const token = /^var\((--[\w-]+)\)$/u.exec(value ?? '')?.[1]
  if (token === undefined) throw new Error(`${value} is not a plain token reference`)
  return token
}

describe('TOASTER_STYLE', () => {
  it.each(TONES)(
    'gives a %s toast a background, text and border from the tokens',
    (tone) => {
      // Sonner names the typed variables `--success-*`, `--info-*`,
      // `--warning-*` and `--error-*`.
      expect(style[`--${tone}-bg`]).toMatch(/^var\(--[\w-]+\)$/)
      expect(style[`--${tone}-text`]).toMatch(/^var\(--[\w-]+\)$/)
      expect(style[`--${tone}-border`]).toMatch(/var\(--[\w-]+\)/)
    },
  )

  it('keeps the plain toast on the popover surface', () => {
    expect(style['--normal-bg']).toBe('var(--popover)')
    expect(style['--normal-text']).toBe('var(--popover-foreground)')
    expect(style['--normal-border']).toBe('var(--border)')
  })

  it('names no colour of its own: no hsl, rgb, oklch or hex literal', () => {
    const literal = /\b(?:hsl|rgb|oklch|lab|lch|hwb)a?\(|#[0-9a-f]{3,8}\b/i
    for (const [name, value] of Object.entries(style)) {
      expect(value, name).not.toMatch(literal)
    }
  })
})

describe('the information toast', () => {
  it('is the information notice: the same fill, ink and edge as the Alert tone', () => {
    // `bg-accent` is `--accent-muted` (styles.css: `--color-accent`).
    expect(TONE_SURFACE.info).toContain('bg-accent')
    expect(style['--info-bg']).toBe('var(--accent-muted)')
    expect(TONE_INK.info).toBe('text-link')
    expect(style['--info-text']).toBe('var(--link)')
    expect(TONE_SURFACE.info).toContain('border-link/25')
    expect(style['--info-border']).toBe(
      'color-mix(in oklab, var(--link) 25%, transparent)',
    )
  })
})

describe('the Toaster icons', () => {
  it('come from the tone table, one glyph per tone wherever it is drawn', () => {
    const source = readFileSync(resolve(__dirname, 'sonner.tsx'), 'utf8')

    for (const tone of ['positive', 'info', 'warn', 'negative']) {
      expect(source).toContain(`TONE_ICON.${tone}`)
    }
    expect(source).not.toMatch(/Octagon/u)
  })
})

describe.each(THEMES)('$name theme toast tones', (theme) => {
  it.each(TONES)('%s text reads at 4.5:1 on its own surface', (tone) => {
    const background = tokenOf(style[`--${tone}-bg`])
    const text = tokenOf(style[`--${tone}-text`])

    expect(
      contrastRatio(colour(theme, text), colour(theme, background)),
    ).toBeGreaterThanOrEqual(AA)
  })
})
