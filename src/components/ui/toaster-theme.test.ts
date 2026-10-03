// The Toaster paints from the app's tokens, not from Sonner's own palette.
//
// Sonner 2 colours a typed toast from hsl() literals keyed on its `theme` prop
// (light by default), so a success toast on the dark UI was a pastel light card
// that ignored `.dark` and `--success`. These cases pin what replaces it: every
// typed colour is a token reference, the text on each tinted surface reads at
// 4.5:1 in both themes, and the `theme` prop follows the theme the app applied.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  contrastRatio,
  readTokenBlock,
  resolveColour,
  type LinearRgb,
} from '#/shared/testing/oklch-contrast'
import { TOAST_TONES, TOASTER_STYLE, type ToastTone } from './toaster-theme'

const AA = 4.5
const TONES = Object.keys(TOAST_TONES) as ToastTone[]

const css = readFileSync(resolve(__dirname, '../../styles.css'), 'utf8')
const light = readTokenBlock(css, ':root')
const dark = readTokenBlock(css, '.dark')
const THEMES = [
  { name: 'light', tokens: light, base: new Map<string, string>() },
  { name: 'dark', tokens: dark, base: light },
] as const

const colour = (theme: (typeof THEMES)[number], token: string): LinearRgb =>
  resolveColour(token, theme.tokens, theme.base)

describe('TOASTER_STYLE', () => {
  const style = TOASTER_STYLE as Record<string, string>

  it.each(TONES)(
    'gives a %s toast a background, text and border from the tokens',
    (tone) => {
      // Sonner names the typed variables `--success-*`, `--info-*`, `--warning-*`
      // and `--error-*`.
      const prefix = tone
      expect(style[`--${prefix}-bg`]).toMatch(/^var\(--[\w-]+\)$/)
      expect(style[`--${prefix}-text`]).toMatch(/^var\(--[\w-]+\)$/)
      expect(style[`--${prefix}-border`]).toMatch(/var\(--[\w-]+\)/)
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

describe.each(THEMES)('$name theme toast tones', (theme) => {
  it.each(TONES)('%s text reads at 4.5:1 on its own surface', (tone) => {
    const { background, text } = TOAST_TONES[tone]

    expect(
      contrastRatio(colour(theme, text), colour(theme, background)),
    ).toBeGreaterThanOrEqual(AA)
  })
})
