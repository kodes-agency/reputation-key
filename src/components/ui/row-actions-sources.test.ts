// One row-actions menu (UI consistency scan: COLL-02, ACT-06).
//
// A row's "more actions" menu was built per screen: a three-dots Button of 24, 32,
// 36 or 44 px with its own ink and four phrasings of its name. `RowActionsMenu`
// owns the trigger, its size, its name and the item rules. These checks read the
// sources, so a new hand-built kebab or an off-pattern name fails here with the
// file named instead of drifting back.

import { describe, expect, it } from 'vitest'
import { readUiSources } from '#/shared/testing/source-tree'

const FILES = readUiSources({ includeTs: true })

/** The three-dots glyph, under every name lucide gives it. */
const KEBAB_GLYPH = /\b(Ellipsis|EllipsisVertical|MoreHorizontal|MoreVertical)\b/u

/** The files that may import it, each for a job that is not a row's menu. */
const GLYPH_ALLOWED: Readonly<Record<string, string>> = {
  'src/components/ui/row-actions-menu.tsx': 'the primitive itself',
  'src/components/ui/breadcrumb.tsx': 'the marker of collapsed crumbs',
}

describe('the three-dots trigger', () => {
  it('is drawn by RowActionsMenu, outside the one place a crumb trail collapses', () => {
    const offenders = FILES.filter(
      (file) => KEBAB_GLYPH.test(file.text) && !(file.path in GLYPH_ALLOWED),
    ).map((file) => file.path)

    expect(offenders).toEqual([])
  })

  it('does not excuse a file that no longer draws one', () => {
    const stale = Object.keys(GLYPH_ALLOWED).filter(
      (path) => !FILES.some((file) => file.path === path && KEBAB_GLYPH.test(file.text)),
    )

    expect(stale).toEqual([])
  })
})

/** The names the triggers used to carry: "Actions for X", "More code actions", a colon. */
const OFF_PATTERN_NAME =
  /['"`](?:Actions for\b|More actions for:|More (?:code|review|row) actions\b)/u

describe('the name of a row-actions trigger', () => {
  it('is "More actions for {name}", written once, by the primitive', () => {
    const offenders = FILES.filter((file) => OFF_PATTERN_NAME.test(file.text)).map(
      (file) => file.path,
    )

    expect(offenders).toEqual([])
  })

  it('catches the phrasings the scan found', () => {
    expect(OFF_PATTERN_NAME.test('label={`Actions for ${name}`}')).toBe(true)
    expect(OFF_PATTERN_NAME.test('aria-label="More code actions"')).toBe(true)
    expect(OFF_PATTERN_NAME.test('label={`More actions for: ${title}`}')).toBe(true)
    expect(OFF_PATTERN_NAME.test('label="More review actions"')).toBe(true)
    expect(OFF_PATTERN_NAME.test('rowActionsLabel(name)')).toBe(false)
  })
})
