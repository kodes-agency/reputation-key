// The ink of a nav row against the fill it sits on, in both themes, measured from
// the stylesheet (UI consistency scan: NAV-05). A section nav draws its current row
// on the sidebar's accent-muted fill and its hovered row on the muted fill, with
// the label, the summary and the count each in their own ink; the Inbox pills put
// their label, accent or muted, and a count on the same fills. Every pair is text,
// so every pair reads at 4.5:1. The keyboard-focus ring every nav row wears is
// measured at the end, at the 3:1 a non-text indicator needs.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  contrastRatio,
  readTokenBlock,
  resolveColour,
  type LinearRgb,
} from '#/shared/testing/oklch-contrast'

const AA = 4.5

const css = readFileSync(resolve(__dirname, '../../styles.css'), 'utf8')
const light = readTokenBlock(css, ':root')
const dark = readTokenBlock(css, '.dark')

const THEMES = [
  { name: 'light', tokens: light, base: new Map<string, string>() },
  { name: 'dark', tokens: dark, base: light },
] as const

const colour = (theme: (typeof THEMES)[number], token: string): LinearRgb =>
  resolveColour(token, theme.tokens, theme.base)

const PAIRS: ReadonlyArray<readonly [ink: string, fill: string, where: string]> = [
  ['--foreground', '--accent-muted', 'the label on the current row'],
  [
    '--muted-foreground',
    '--accent-muted',
    'the summary and the count on the current row',
  ],
  ['--foreground', '--muted', 'the label on a hovered row'],
  ['--muted-foreground', '--muted', 'the summary on a hovered row, an inactive pill'],
  ['--foreground', '--background', 'the label on a row at rest'],
  ['--muted-foreground', '--background', 'the summary and the count at rest'],
  ['--accent', '--accent-muted', 'the label and the icon of the current pill'],
  ['--negative', '--accent-muted', 'the Escalated count on the current queue'],
  ['--negative', '--muted', 'the Escalated count on an inactive pill'],
  ['--negative', '--background', 'the Escalated count at rest'],
]

describe.each(THEMES)('$name theme nav ink', (theme) => {
  it.each(PAIRS)('%s on %s (%s) reads at 4.5:1', (ink, fill) => {
    expect(contrastRatio(colour(theme, fill), colour(theme, ink))).toBeGreaterThanOrEqual(
      AA,
    )
  })
})

// A focus indicator is not text: it needs 3:1 against what it sits beside (WCAG
// 1.4.11), not 4.5:1. The shared `focus-ring` is the Button's 3px halo at 50% around
// a full-strength edge. The halo alone measures 1.65:1 on the dark page and 1.92:1 on
// the light one, so the edge, a 1px outline in the ring token, is what carries it,
// beside the page, a card and the current row's fill.
const FOCUS_NEIGHBOURS: ReadonlyArray<readonly [fill: string, where: string]> = [
  ['--background', 'the page'],
  ['--card', 'a card'],
  ['--accent-muted', 'the current row'],
]

describe.each(THEMES)('$name theme focus ring', (theme) => {
  it.each(FOCUS_NEIGHBOURS)('--ring on %s (%s) reads at 3:1', (fill) => {
    expect(
      contrastRatio(colour(theme, '--ring'), colour(theme, fill)),
    ).toBeGreaterThanOrEqual(3)
  })
})

describe('the focus-ring utility', () => {
  const rule = /@utility focus-ring \{([\s\S]*?)\n\}/u.exec(css)?.[1] ?? ''

  it('draws the full-strength edge the measurement above is of', () => {
    expect(rule).toContain('outline: 1px solid var(--ring)')
  })

  it('keeps the Button halo around it', () => {
    expect(rule).toContain('ring-[3px]')
    expect(rule).toContain('ring-ring/50')
  })
})
