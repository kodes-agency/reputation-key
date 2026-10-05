// Colour in the source (UI consistency scan: SURF-05, SURF-11, COLL-05, COLL-09).
//
// A status colour was whatever token its author reached for: raw Tailwind amber
// and emerald beside the --warn and --positive tokens, two red-text tokens for
// one meaning, a literal oklch() in a header, and a tinted box drawn by hand
// wherever a notice or a status pill was wanted. Alert, Badge and StatusBadge
// (with `tone.ts` behind them) are the one implementation, and the tokens in
// styles.css are the only colours. These checks read the sources, so a new raw
// colour, a hand-tinted notice or a fill-grade red used as text fails here with the file
// named instead of drifting back. (They are the unit-test form of the lint
// rules the scan proposes; they can retire when those land.)

import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stripComments, walk } from '#/shared/testing/source-tree'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const SOURCES = ['src/components', 'src/routes'] as const

// The guest renderer is the owner's reference experience and is out of scope
// for the consistency work; it keeps its own colour decisions.
const OUT_OF_SCOPE = 'src/components/features/guest/'

const FILES = SOURCES.flatMap((source) => walk(join(ROOT, source)))
  .map((path) => relative(ROOT, path))
  .filter(
    (path) =>
      /\.tsx?$/u.test(path) &&
      !/\.(stories|test)\./u.test(path) &&
      !path.includes('.stories.') &&
      !path.includes('__fixtures__') &&
      !/-fixtures\.tsx?$/u.test(path) &&
      !path.startsWith(OUT_OF_SCOPE),
  )
  .map((path) => ({ path, text: readFileSync(join(ROOT, path), 'utf8') }))

function offendersOf(pattern: RegExp, allowed: Readonly<Record<string, string>> = {}) {
  return FILES.filter(
    (file) => pattern.test(stripComments(file.text)) && !(file.path in allowed),
  )
    .map((file) => file.path)
    .sort()
}

function staleIn(pattern: RegExp, allowed: Readonly<Record<string, string>>) {
  return Object.keys(allowed).filter(
    (path) =>
      !FILES.some((file) => file.path === path && pattern.test(stripComments(file.text))),
  )
}

/** A Tailwind palette colour (`amber-500`) behind any utility or variant. */
const RAW_PALETTE =
  /\b(?:text|bg|border|fill|stroke|ring|from|to|via|divide|outline|decoration|shadow|accent|caret)-(?:amber|emerald|red|green|yellow|neutral|gray|grey|slate|zinc|stone|orange|lime|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/u

describe('raw palette colours', () => {
  it('are not in a class: the tokens in styles.css are the palette', () => {
    expect(offendersOf(RAW_PALETTE)).toEqual([])
  })

  it('catches the spellings the sweep removed', () => {
    // Spelled in pieces: Tailwind scans test files, and a whole class here
    // would ship its rule in the stylesheet every page loads.
    const raw = (utility: string, colour: string, shade: string) =>
      [utility, colour, shade].join('-')
    for (const sample of [
      `${raw('fill', 'amber', '500')} ${raw('text', 'amber', '500')}`,
      raw('text', 'emerald', '600'),
      `md:${raw('text', 'red', '500')}`,
      raw('bg', 'neutral', '900'),
      `dark:${raw('bg', 'yellow', '400')}/20`,
    ]) {
      expect(RAW_PALETTE.test(sample)).toBe(true)
    }
    for (const sample of ['text-positive', 'text-rating', 'border-border']) {
      expect(RAW_PALETTE.test(sample)).toBe(false)
    }
  })
})

// Spelled in pieces: Tailwind scans every source file, comments and tests
// included, and the class named whole would keep its rule in the stylesheet.
const FILL_GRADE_RED_TEXT = ['text', 'destructive'].join('-')

/** Red text in the fill-grade token, with or without a variant in front of it. */
const RED_TEXT_FILL_TOKEN = new RegExp(`(?<![\\w-])${FILL_GRADE_RED_TEXT}(?![\\w-])`, 'u')

describe('red text', () => {
  it('is the text-grade red, not the fill-grade token a button is painted with', () => {
    expect(offendersOf(RED_TEXT_FILL_TOKEN)).toEqual([])
  })

  it('catches it behind a variant, and leaves the on-fill token alone', () => {
    const fillGrade = FILL_GRADE_RED_TEXT
    expect(RED_TEXT_FILL_TOKEN.test(`hover:${fillGrade}`)).toBe(true)
    expect(RED_TEXT_FILL_TOKEN.test(`data-[variant=destructive]:${fillGrade}`)).toBe(true)
    expect(RED_TEXT_FILL_TOKEN.test(`${fillGrade}-foreground`)).toBe(false)
    expect(RED_TEXT_FILL_TOKEN.test('text-negative')).toBe(false)
  })
})

/**
 * The files that may name a colour literal, each for a job that is not themed
 * UI chrome. Everything else uses a token.
 */
const LITERAL_ALLOWED: Readonly<Record<string, string>> = {
  'src/components/ui/chart.tsx':
    'attribute selectors that match the stroke colours Recharts paints by default, to override them',
  'src/components/ui/strip-scroll.ts':
    'opaque and transparent stops of a fade mask: only their alpha is used',
  'src/components/features/portal/portal-share/portal-qr.ts':
    'the printed QR ink and paper: fixed so the code scans in either theme',
  'src/components/features/portal/portal-share/print-kit-art.tsx':
    'the print kit is a printed card with its own palette, not app chrome',
  'src/components/features/portal/portal-preview/preview-phone.tsx':
    'the device bezel the portal preview is drawn inside',
  'src/components/features/property/property-public-display-name-card.tsx':
    'fallback brand colours of a portal profile that has none: data, not styling',
}

/** An oklch(), hsl() or hex colour in code. */
const COLOUR_LITERAL = /oklch\(|hsla?\(|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/u

describe('literal colours', () => {
  it('are in styles.css, not in a component', () => {
    expect(offendersOf(COLOUR_LITERAL, LITERAL_ALLOWED)).toEqual([])
  })

  it('are not excused for a file that no longer holds one', () => {
    expect(staleIn(COLOUR_LITERAL, LITERAL_ALLOWED)).toEqual([])
  })
})

/**
 * The files that may paint a tinted tone surface themselves, each for a job
 * that is not a notice or a status pill. Everything else is Alert, Badge or
 * StatusBadge, which own the tint, the edge and the ink.
 */
const TINT_ALLOWED: Readonly<Record<string, string>> = {
  'src/components/ui/tone.ts': 'the tone table itself',
  'src/components/ui/empty-state.tsx':
    'the disc behind the icon of a failed region: a disc, not a message box',
  'src/components/inbox/note-message.tsx':
    'the private note: its amber is the pane’s colour for "not public"',
  'src/components/inbox/composer-mode-row.tsx': 'the composer’s private-note mode cue',
  'src/components/inbox/reply-composer.tsx': 'the composer’s private-note dock',
}

/** A tone's tint or edge as a utility. */
const TONE_TINT =
  /(?<![\w-])(?:bg-(?:warn-muted|positive-muted|negative-muted|success-muted)|border-warn-line)(?![\w-])/u

describe('tinted tone surfaces', () => {
  it('are drawn by tone.ts through Alert, Badge and StatusBadge', () => {
    expect(offendersOf(TONE_TINT, TINT_ALLOWED)).toEqual([])
  })

  it('are not excused for a file that no longer paints one', () => {
    expect(staleIn(TONE_TINT, TINT_ALLOWED)).toEqual([])
  })
})
