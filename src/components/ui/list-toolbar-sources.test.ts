// One list toolbar (UI consistency scan: COLL-06, COLL-12, COLL-13, COLL-22).
//
// The Properties list and the Portals overview copied each other's toolbar and
// drifted (a length limit on one, not the other); the Inbox, Google import and a
// member invitation each drew their own search field, Clear control and removable
// chip, under four wordings of "Clear". `SearchField`, `ListFilterMenu`,
// `ListSortMenu`, `ResultCount`, `ClearFiltersButton` and `RemovableChip` are the
// one implementation. These checks read the sources, so a new search box, a new
// Clear label or a second declaration of the sort direction fails here with the
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

describe('a search input is SearchField', () => {
  // Spelled in pieces: this file is read as source by the checks of other files.
  const SEARCH_TYPE = /type=["']search["']|type:\s*["']search["']/u
  const SEARCH_ALLOWED: Readonly<Record<string, string>> = {
    'src/components/ui/search-field.tsx': 'the primitive itself',
  }
  const spellsSearchType = (file: SourceFile) => SEARCH_TYPE.test(file.text)

  it('is not a hand-built `type="search"` input', () => {
    expect(offendersOf(spellsSearchType, SEARCH_ALLOWED)).toEqual([])
  })

  it('lists no file that no longer draws one', () => {
    expect(staleIn(spellsSearchType, SEARCH_ALLOWED)).toEqual([])
  })

  /** The Search glyph is the field's; a bar that only opens a search draws its own button. */
  const GLYPH = /import\s*\{[^}]*\bSearch\b[^}]*\}\s*from\s*['"]lucide-react['"]/u
  const GLYPH_ALLOWED: Readonly<Record<string, string>> = {
    'src/components/ui/search-field.tsx': 'the primitive itself',
    'src/components/inbox/inbox-list-header.tsx':
      'the icon button that opens the search: it is not a field',
  }
  const importsGlyph = (file: SourceFile) => GLYPH.test(file.text)

  it('is not a Search glyph set beside a hand-placed Input', () => {
    expect(offendersOf(importsGlyph, GLYPH_ALLOWED)).toEqual([])
  })

  it('lists no file that no longer imports the glyph', () => {
    expect(staleIn(importsGlyph, GLYPH_ALLOWED)).toEqual([])
  })
})

describe('a list says "Clear filters"', () => {
  /** The wordings the toolbars, empty results, popover and sheet used to spell. */
  const OLD_CLEAR =
    /\bClear all\b|Clear search and filter(?!s)|Clear the filters|>\s*Clear\s*<|^\s*Clear\s*$|(['"`])Clear\1/mu

  it('is `ClearFiltersButton`, not a "Clear", "Clear all" or "Clear search and filter" of its own', () => {
    expect(offendersOf((file) => OLD_CLEAR.test(file.text))).toEqual([])
  })

  it('catches the old wordings', () => {
    expect(OLD_CLEAR.test('<Button>\n  Clear all\n</Button>')).toBe(true)
    expect(OLD_CLEAR.test('Clear search and filter')).toBe(true)
    expect(OLD_CLEAR.test("label: 'Clear'")).toBe(true)
    expect(OLD_CLEAR.test('<Button>\n  Clear\n</Button>')).toBe(true)
    expect(OLD_CLEAR.test('Clear search and filters')).toBe(false)
    expect(OLD_CLEAR.test('Clear selection')).toBe(false)
    expect(OLD_CLEAR.test('Clear filters')).toBe(false)
  })

  it('counts "N of M", never "N matches"', () => {
    expect(offendersOf((file) => /\}\s+matches\b/u.test(file.text))).toEqual([])
  })
})

describe('a list menu draws the one filter and sort glyphs', () => {
  // `Filter` (a funnel) and `ArrowUpDown` were the Inbox's, and the unsorted cue of
  // a table's column header; the toolbars drew `ListFilter` and `ArrowDownUp`, so
  // one control had two faces.
  const OLD_GLYPH =
    /import\s*\{[^}]*\b(?:Filter|ArrowUpDown)\b[^}]*\}\s*from\s*['"]lucide-react['"]/u
  const importsOldGlyph = (file: SourceFile) => OLD_GLYPH.test(file.text)

  it('are ListFilter and ArrowDownUp, the unsorted cue of a column header too', () => {
    expect(offendersOf(importsOldGlyph)).toEqual([])
  })

  it('catches the old glyphs', () => {
    expect(OLD_GLYPH.test("import { ArrowUpDown } from 'lucide-react'")).toBe(true)
    expect(OLD_GLYPH.test("import { Filter, X } from 'lucide-react'")).toBe(true)
    expect(OLD_GLYPH.test("import { ArrowDownUp, ListFilter } from 'lucide-react'")).toBe(
      false,
    )
  })
})

describe('the sort direction is declared once', () => {
  const DECLARES = /\btype\s+SortDirection\s*=/u
  const DECLARES_ALLOWED: Readonly<Record<string, string>> = {
    'src/components/ui/list-sort.ts': 'the one declaration',
  }

  it('is `#/components/ui/list-sort`, not a per-list copy', () => {
    expect(offendersOf((file) => DECLARES.test(file.text), DECLARES_ALLOWED)).toEqual([])
  })
})

describe('a removable choice is RemovableChip', () => {
  // The Inbox's chip was a raw button with an X, the invitation's a Badge with a
  // second button inside it.
  const BADGE_WITH_BUTTON = /<Badge\b[^>]*>[\s\S]{0,200}<button\b/u

  it('is not a Badge with a button inside it', () => {
    expect(offendersOf((file) => BADGE_WITH_BUTTON.test(file.text))).toEqual([])
  })
})
