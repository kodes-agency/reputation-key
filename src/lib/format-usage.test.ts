// One module formats dates and numbers (UI consistency scan: COLL-19).
//
// A per-file `Intl.DateTimeFormat`, `Intl.NumberFormat` or bare `toLocaleString`
// is how the same review date came to read "Sep 12, 2026" on Overview and
// "12 Sep 2026" on Guest voice, and how an unpinned locale or zone risked a
// hydration mismatch. These checks read the sources, so a new formatter that
// should be `#/lib/format` fails here with the file named. The few files that
// honour a person's or a guest's own locale or zone are listed with the reason.

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..', '..')
const SOURCES = ['src/components', 'src/routes'] as const

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return /\.tsx?$/u.test(entry.name) && !/\.(stories|test)\./u.test(entry.name)
      ? [path]
      : []
  })
}

/** The source without its comments, which are free to name the constructors. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|\s)\/\/.*$/gmu, '$1')
}

const FILES = SOURCES.flatMap((source) => walk(join(ROOT, source))).map((path) => ({
  path: relative(ROOT, path),
  text: code(readFileSync(path, 'utf8')),
}))

/** A date or number formatter built by hand, or a runtime-locale `toLocale*String`. */
const HAND_FORMATTER =
  /\bIntl\.(?:DateTimeFormat|NumberFormat)\b|\.toLocale(?:Date|Time)?String\(/u

const ALLOWED: Readonly<Record<string, string>> = {
  'src/components/features/notification/notification-utils.ts':
    'times in the person’s own locale and zone preference',
  'src/components/features/notification/notification-filters.ts':
    'the notification bell’s day grouping; it is in the first-paint closure, where the format module is not',
  'src/components/features/settings/notification-formatting-form.tsx':
    'previews the person’s own locale and zone choice',
  'src/components/features/portal/portal-analytics/portal-lifetime-reconciliation-presentation.ts':
    'takes the locale and zone it is given',
  'src/components/features/guest/public-portal/guest-deadline-format.ts':
    'the guest renderer, in the guest’s language',
  'src/components/features/beta-feedback/beta-feedback-reports.tsx':
    'reads the runtime’s zone name, not a format',
  'src/components/inbox/reply-check-feedback.ts':
    'a clock time in the viewer’s own locale preference (12 or 24 hour)',
}

describe('date and number formatting', () => {
  const draws = (file: { text: string }) => HAND_FORMATTER.test(file.text)

  it('is #/lib/format, outside the few places that honour a person’s own locale', () => {
    const offenders = FILES.filter((file) => draws(file) && !(file.path in ALLOWED)).map(
      (file) => file.path,
    )

    expect(offenders).toEqual([])
  })

  it('lists no file that no longer builds its own formatter', () => {
    const stale = Object.keys(ALLOWED).filter(
      (path) => !FILES.some((file) => file.path === path && draws(file)),
    )

    expect(stale).toEqual([])
  })

  it('catches the spellings the scan found', () => {
    expect(HAND_FORMATTER.test("new Intl.DateTimeFormat('en-US', {})")).toBe(true)
    expect(HAND_FORMATTER.test('const f = new Intl.NumberFormat()')).toBe(true)
    expect(HAND_FORMATTER.test('count.toLocaleString()')).toBe(true)
    expect(HAND_FORMATTER.test("new Date().toLocaleTimeString('en')")).toBe(true)
    expect(HAND_FORMATTER.test('new Intl.DisplayNames(["en"], {})')).toBe(false)
    expect(HAND_FORMATTER.test('name.toLocaleLowerCase()')).toBe(false)
  })
})
