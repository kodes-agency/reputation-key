// The ink of a nav row against the fill it sits on, in both themes, measured from
// the stylesheet (UI consistency scan: NAV-05). A section nav draws its current row
// on the sidebar's accent-muted fill and its hovered row on the muted fill, with
// the label, the summary and the count each in their own ink; the Inbox pills put
// their label, accent or muted, and a count on the same fills. Every pair is text,
// so every pair reads at 4.5:1.
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
