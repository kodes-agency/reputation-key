// One control per choice (UI consistency scan: FORM-03, FORM-08, FORM-09, FORM-11).
//
// A choice in a settings page or a form was drawn with a browser <select> or a raw
// checkbox, a boolean with a Switch in five arrangements (or a Checkbox standing in
// for one), "follow the parent or set my own" with a Checkbox, a pair of buttons or a
// reset dialog, "I have read this notice" with four different frames, and "how low a
// rating" as a native select, a Select and a number box. The shared controls are the
// Select, the `SettingSwitchRow`, the `InheritedSetting`, the `ConsentCheckbox` and the
// `RatingThresholdField`. These checks read the sources, so a new native select, a
// Switch drawn by hand or a consent sentence in a bare Checkbox fails here with the
// file named instead of drifting back.

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..', '..', '..')
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

/** The source without its comments, which are free to quote the old spellings. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|\s)\/\/.*$/gmu, '$1')
}

const FILES = SOURCES.flatMap((source) => walk(join(ROOT, source))).map((path) => ({
  path: relative(ROOT, path),
  text: code(readFileSync(path, 'utf8')),
}))

type SourceFile = (typeof FILES)[number]

const offendersOf = (
  matches: (file: SourceFile) => boolean,
  allowed: Readonly<Record<string, string>> = {},
) => FILES.filter((file) => matches(file) && !(file.path in allowed)).map((f) => f.path)

const staleIn = (
  matches: (file: SourceFile) => boolean,
  allowed: Readonly<Record<string, string>>,
) =>
  Object.keys(allowed).filter(
    (path) => !FILES.some((file) => file.path === path && matches(file)),
  )

const usedIn = (pattern: RegExp) => FILES.filter((file) => pattern.test(file.text))

/** The source with every `<tag ...>...</tag>` element cut out, by position (no pattern to get wrong). */
function withoutElement(text: string, tag: string): string {
  const open = `<${tag}`
  const close = `</${tag}>`
  let rest = text
  let kept = ''
  for (;;) {
    const start = rest.indexOf(open)
    const end = start === -1 ? -1 : rest.indexOf(close, start)
    if (end === -1) return kept + rest
    kept += rest.slice(0, start)
    rest = rest.slice(end + close.length)
  }
}

describe('a choice is the shared Select or Checkbox, never a native control', () => {
  it('has no browser <select>: it draws its own popup, height, focus ring and dark surface', () => {
    const NATIVE_SELECT = /<select\b/u

    expect(offendersOf((file) => NATIVE_SELECT.test(file.text))).toEqual([])
    expect(NATIVE_SELECT.test('<select id="metric" className="h-9">')).toBe(true)
  })

  it('has no raw checkbox input', () => {
    const RAW_CHECKBOX = /<input\b[^>]*\btype=["']checkbox["']/u

    expect(offendersOf((file) => RAW_CHECKBOX.test(file.text))).toEqual([])
    expect(RAW_CHECKBOX.test('<input type="checkbox" className="size-4" />')).toBe(true)
  })
})

describe('a boolean setting is a SettingSwitchRow', () => {
  const SWITCH_IMPORT = /from '#\/components\/ui\/switch'/u
  const SWITCH_ALLOWED: Readonly<Record<string, string>> = {
    'src/components/forms/setting-switch-row.tsx': 'the row that owns the Switch',
  }
  const importsSwitch = (file: SourceFile) => SWITCH_IMPORT.test(file.text)

  it('draws no Switch of its own: the row names the label, the help and when it saves', () => {
    expect(offendersOf(importsSwitch, SWITCH_ALLOWED)).toEqual([])
  })

  it('lists no file that no longer imports the Switch', () => {
    expect(staleIn(importsSwitch, SWITCH_ALLOWED)).toEqual([])
  })

  it('sees the rows in use, so the rule cannot pass for lack of matches', () => {
    expect(usedIn(/<SettingSwitchRow\b/u).length).toBeGreaterThan(6)
  })

  it('is not a Checkbox standing in for a setting that is on or off', () => {
    // The Organization's low-rating target was a raw checkbox, and the Property's
    // target a Checkbox that waits for Save: each is a row of its own now.
    const settingCheckbox = (file: SourceFile) =>
      /<Checkbox\b/u.test(file.text) &&
      /Answer low-rated reviews sooner|Use Organization target/u.test(file.text)

    expect(offendersOf(settingCheckbox)).toEqual([])
  })
})

describe('"follow the parent or set my own" is an InheritedSetting', () => {
  it('is used by the Property target, the quiet hours and the notification defaults', () => {
    const users = usedIn(/<InheritedSetting\b/u).map((file) => file.path)

    expect(users).toEqual(
      expect.arrayContaining([
        'src/components/features/property/private-feedback-target-card.tsx',
        'src/components/features/settings/notification-quiet-hours-card.tsx',
        'src/components/features/settings/notification-default-controls.tsx',
      ]),
    )
  })

  it('is not a pair of buttons that swap places to say the same thing', () => {
    const BUTTON_PAIR = /Use different hours here|Follow my quiet hours here/u
    const spellsPair = (file: SourceFile) =>
      BUTTON_PAIR.test(file.text) && !/<InheritedSetting\b/u.test(file.text)

    expect(offendersOf(spellsPair)).toEqual([])
  })
})

describe('a statement the person agrees to is a ConsentCheckbox', () => {
  const SENTENCE =
    /I have read this notice|I have checked these details|I opened every destination|owns this (?:photo|logo)|has permission to use it/u
  // A file may hold a ConsentCheckbox and, elsewhere, a Checkbox list of its own (the AI
  // features): what fails is the sentence outside a ConsentCheckbox, beside a Checkbox.
  const bareCheckbox = (file: SourceFile) => {
    const outside = withoutElement(file.text, 'ConsentCheckbox')
    return SENTENCE.test(outside) && /<Checkbox\b/u.test(outside)
  }

  it('is not a bare Checkbox with the sentence rebuilt beside it', () => {
    expect(offendersOf(bareCheckbox)).toEqual([])
  })

  it('sees the consents in use, so the rule cannot pass for lack of matches', () => {
    expect(usedIn(/<ConsentCheckbox\b/u).length).toBeGreaterThan(5)
  })

  it('catches the spelling the scan found, and lets the shared control hold the sentence', () => {
    const rebuilt = '<Checkbox id="x" /><FieldLabel>I have read this notice</FieldLabel>'
    const shared = '<ConsentCheckbox id="x">I have read this notice</ConsentCheckbox>'

    expect(SENTENCE.test(rebuilt)).toBe(true)
    expect(SENTENCE.test(withoutElement(shared, 'ConsentCheckbox'))).toBe(false)
  })
})

describe('"how low a rating" is a RatingThresholdField', () => {
  const WORDS = /★ or lower|★ only|stars? or (?:lower|below)|At or below \(stars\)/u
  const WORDS_ALLOWED: Readonly<Record<string, string>> = {
    'src/components/forms/rating-threshold.ts': 'the one place the words live',
  }
  const spellsWords = (file: SourceFile) => WORDS.test(file.text)

  it('words a threshold in one place, with the glyph for the eye and the word for the ear', () => {
    expect(offendersOf(spellsWords, WORDS_ALLOWED)).toEqual([])
    expect(staleIn(spellsWords, WORDS_ALLOWED)).toEqual([])
  })

  it('is the field on the Portal editor, the notification page and the Organization targets', () => {
    const users = usedIn(/<RatingThresholdField\b/u).map((file) => file.path)

    expect(users).toEqual(
      expect.arrayContaining([
        'src/components/features/portal/portal-editor/portal-private-note-form.tsx',
        'src/components/features/settings/notifications-low-ratings-controls.tsx',
        'src/components/features/organization/response-target-settings-card.tsx',
      ]),
    )
  })
})
