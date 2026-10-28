// An urgent row's tint and every ink printed on it, measured from the
// stylesheet in both themes (the method of `ui/token-contrast.test.ts`). The
// fills and the red inks are read from the classes the row is given, so the
// measurement follows the component. The tint and the hover wash are
// translucent, so each is composited over the page before it is measured. Text
// reads at 4.5:1; the focus ring's 1px edge, which carries the shared
// `focus-ring` (see `ui/nav-contrast.test.ts`), at 3:1.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CircleAlert, Flag } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import {
  composite,
  contrastRatio,
  readTokenBlock,
  resolveColour,
  type LinearRgb,
} from '#/shared/testing/oklch-contrast'
import { TONE_ICON, TONE_INK } from '#/components/ui/tone'
import { URGENT_ROW_TINT, inboxRowFill, inboxRowSignalTone } from './inbox-list-row-tone'

const AA = 4.5
const FOCUS = 3

const css = readFileSync(resolve(__dirname, '../../styles.css'), 'utf8')
const light = readTokenBlock(css, ':root')
const dark = readTokenBlock(css, '.dark')
const themeBlock = readTokenBlock(css, '@theme inline')

const THEMES = [
  { name: 'light', tokens: light, base: new Map<string, string>() },
  { name: 'dark', tokens: dark, base: light },
] as const

type Theme = (typeof THEMES)[number]

const colour = (theme: Theme, token: string): LinearRgb =>
  resolveColour(token, theme.tokens, theme.base)

/**
 * A `bg-*` or `text-*` colour utility, with or without an `/<alpha>`, as the
 * token it paints (by the stylesheet's `@theme` block) and its opacity.
 */
function paintOf(
  utility: string,
  prefix: 'bg' | 'text',
): Readonly<{ token: string; alpha: number }> {
  const match = new RegExp(`^${prefix}-([\\w-]+?)(?:/(\\d+))?$`).exec(utility)
  if (match === null) throw new Error(`${utility} is not a ${prefix}-* utility`)
  const mapped = themeBlock.get(`--color-${match[1]!}`)
  const token = mapped === undefined ? null : /^var\((--[\w-]+)\)$/.exec(mapped)?.[1]
  if (token == null) throw new Error(`${prefix}-${match[1]!} is not a mapped colour`)
  return { token, alpha: match[2] === undefined ? 1 : Number(match[2]) / 100 }
}

const fillOf = (utility: string) => paintOf(utility, 'bg')

/** The fill `inboxRowFill` gives a row in that state; it must give one. */
function rowFill(state: Partial<Parameters<typeof inboxRowFill>[0]>): string {
  const fill = inboxRowFill({
    isActive: false,
    isChecked: false,
    isUrgent: true,
    ...state,
  })
  if (fill === null) throw new Error(`no fill for ${JSON.stringify(state)}`)
  return fill
}

// The hover wash is the row's own class, read from its source so the
// measurement follows the component. Spelled in pieces: Tailwind scans tests.
const rowSource = readFileSync(resolve(__dirname, 'inbox-list-row.tsx'), 'utf8')
const HOVER_PREFIX = ['hover', ''].join(':')
const hoverUtility = new RegExp(`${HOVER_PREFIX}(bg-accent/\\d+)`).exec(rowSource)?.[1]

function fillOverPage(theme: Theme, utility: string): LinearRgb {
  const { token, alpha } = fillOf(utility)
  return composite(colour(theme, token), colour(theme, '--background'), alpha)
}

/** Every fill an urgent row can wear: at rest, under the pointer, open or checked. */
const FILLS: ReadonlyArray<readonly [state: string, fill: (theme: Theme) => LinearRgb]> =
  [
    ['the urgent tint at rest', (theme) => fillOverPage(theme, rowFill({}))],
    ['the hover wash', (theme) => fillOverPage(theme, hoverUtility ?? '')],
    ['the open fill', (theme) => fillOverPage(theme, rowFill({ isActive: true }))],
    ['the checked fill', (theme) => fillOverPage(theme, rowFill({ isChecked: true }))],
  ]

/** The ink a row signal prints in, as its token; it must be an opaque one. */
function signalInk(signal: string): string {
  const tone = inboxRowSignalTone(signal)
  if (tone === null) throw new Error(`${signal} has no tone`)
  const { token, alpha } = paintOf(tone.ink, 'text')
  if (alpha !== 1) throw new Error(`${tone.ink} is translucent`)
  return token
}

/**
 * The inks a row prints: the page ink (name and rating) and the summary's
 * `text-muted-foreground` (summary, fallback copy and time), then the red
 * signals' inks as `inboxRowSignalTone` gives them.
 */
const INKS = [
  ...new Set([
    '--foreground',
    '--muted-foreground',
    signalInk('Urgent'),
    signalInk('Escalated'),
  ]),
]

describe('the High signal (ADR 0071)', () => {
  it('prints in the page ink, so it is measured with the other inks below', () => {
    expect(signalInk('High')).toBe('--foreground')
    expect(inboxRowSignalTone('High')?.Icon).toBeTypeOf('function')
  })
})

describe('the urgent row recipe', () => {
  it('is the negative tone’s own fill', () => {
    expect(fillOf(URGENT_ROW_TINT).token).toBe('--destructive-muted')
  })

  it('prints the red labels in the text-grade red', () => {
    expect(signalInk('Urgent')).toBe('--negative')
    expect(signalInk('Escalated')).toBe('--negative')
  })

  it('finds the hover wash in the row', () => {
    expect(hoverUtility).toBeDefined()
  })
})

describe.each(THEMES)('$name theme urgent row', (theme) => {
  describe.each(FILLS)('on %s', (_state, fill) => {
    it.each(INKS)('%s reads at 4.5:1 or better', (ink) => {
      expect(contrastRatio(fill(theme), colour(theme, ink))).toBeGreaterThanOrEqual(AA)
    })

    it('the focus ring’s edge reads at 3:1 or better', () => {
      expect(contrastRatio(fill(theme), colour(theme, '--ring'))).toBeGreaterThanOrEqual(
        FOCUS,
      )
    })
  })
})

describe('row signal tones', () => {
  it('prints Urgent in the negative tone with that tone’s icon', () => {
    expect(inboxRowSignalTone('Urgent')).toEqual({
      ink: TONE_INK.negative,
      Icon: TONE_ICON.negative,
    })
    expect(TONE_ICON.negative).toBe(CircleAlert)
  })

  it('keeps Escalated in the same red with its Flag, so the two stay told apart', () => {
    expect(inboxRowSignalTone('Escalated')).toEqual({
      ink: TONE_INK.negative,
      Icon: Flag,
    })
  })

  it('leaves a reply state plain', () => {
    expect(inboxRowSignalTone('Awaiting approval')).toBeNull()
  })
})
