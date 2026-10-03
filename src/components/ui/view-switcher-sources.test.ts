// One way to switch views and one way to pick a range (UI consistency scan:
// NAV-04, NAV-08, COLL-01, COLL-11, COLL-14, ACT-11, ACT-18).
//
// A page's sibling views were three looks from two primitives plus a hand-drawn
// link strip, Goals' Active / History was two Buttons with no selected state, and
// the dashboard's range was pressed Buttons beside a SegmentedControl that names
// "range" as its use. Decision 7 of the plan: a page's views are underline tabs
// (`LinkTabs` when each is a route, `Tabs variant="line"` when they swap a panel
// in the same document), and the grey pill is only for a mode inside a component.
// `RangeControl` is the one range control. These checks read the sources, so a
// new pill on a page, a hand-drawn underline strip or a second range picker fails
// here with the file named instead of drifting back. (They are the unit-test form
// of the lint rules the scan proposes; they can retire when those land.)

import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walk } from '#/shared/testing/source-tree'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const SOURCES = ['src/components', 'src/routes'] as const

const FILES = SOURCES.flatMap((source) => walk(join(ROOT, source)))
  .map((path) => relative(ROOT, path))
  .filter(
    (path) =>
      /\.tsx?$/u.test(path) &&
      !/\.(stories|test)\./u.test(path) &&
      !path.includes('.stories.'),
  )
  .map((path) => ({ path, text: readFileSync(join(ROOT, path), 'utf8') }))

/** The source without its comments, which are free to quote the old spellings. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|\s)\/\/.*$/gmu, '$1')
}

/** A `<TabsList` opening tag, with its props, up to the `>` that closes it. */
function tabsListTags(text: string): string[] {
  const tags: string[] = []
  for (const match of text.matchAll(/<TabsList\b/gu)) {
    let braces = 0
    let end = match.index
    for (; end < text.length; end += 1) {
      const char = text[end]
      if (char === '{') braces += 1
      else if (char === '}') braces -= 1
      else if (char === '>' && braces === 0) break
    }
    tags.push(text.slice(match.index, end + 1))
  }
  return tags
}

/**
 * The pill is for a mode inside a component: the composer's Reply / Note and the
 * beta dialog's Report / Reports. A page-level view is never listed here.
 */
const IN_COMPONENT_MODES: Readonly<Record<string, string>> = {
  'src/components/inbox/composer-mode-row.tsx':
    'the composer writes as a reply or a note',
  'src/components/features/beta-feedback/beta-feedback-dialog-body.tsx':
    "the feedback dialog's Report / Reports modes",
}

describe('page-level view switchers', () => {
  it('draw a TabsList as the underline, except for a mode inside a component', () => {
    const offenders = FILES.filter(
      (file) =>
        file.path !== 'src/components/ui/tabs.tsx' &&
        !(file.path in IN_COMPONENT_MODES) &&
        tabsListTags(code(file.text)).some((tag) => !/variant="line"/u.test(tag)),
    ).map((file) => file.path)

    expect(offenders).toEqual([])
  })

  it('keep the in-component allowlist honest: every entry still draws a pill', () => {
    const stale = Object.keys(IN_COMPONENT_MODES).filter(
      (path) =>
        !FILES.some(
          (file) =>
            file.path === path &&
            tabsListTags(code(file.text)).some((tag) => !/variant="line"/u.test(tag)),
        ),
    )

    expect(stale).toEqual([])
  })

  it('never hand-draw the underline: the 2px underline recipe is written once', () => {
    const offenders = FILES.filter(
      (file) =>
        file.path !== 'src/components/ui/tabs-line-styles.ts' &&
        /after:h-0\.5/u.test(code(file.text)),
    ).map((file) => file.path)

    expect(offenders).toEqual([])
  })

  it('never switch views with Buttons: a view link is a LinkTab, not a toggled Button', () => {
    const offenders = FILES.filter((file) =>
      /variant=\{[^}]*(?:view|tab)\s*===[^}]*\?\s*'default'\s*:\s*'outline'\}/u.test(
        code(file.text),
      ),
    ).map((file) => file.path)

    expect(offenders).toEqual([])
  })
})

describe('the range control', () => {
  it('is the one place a control is named "Time range"', () => {
    const offenders = FILES.filter(
      (file) =>
        file.path !== 'src/components/ui/range-control.tsx' &&
        /['"`]Time range['"`]/u.test(code(file.text)),
    ).map((file) => file.path)

    expect(offenders).toEqual([])
  })

  it('words every window from the one table: "30 days", never "Last 30 days"', () => {
    const offenders = FILES.filter((file) =>
      /label:\s*['"`]Last \d+ days['"`]/u.test(code(file.text)),
    ).map((file) => file.path)

    expect(offenders).toEqual([])
  })

  it('is not drawn as pressed Buttons', () => {
    const offenders = FILES.filter((file) =>
      /aria-pressed=\{(?:range|timeRange)\s*===/u.test(code(file.text)),
    ).map((file) => file.path)

    expect(offenders).toEqual([])
  })
})
