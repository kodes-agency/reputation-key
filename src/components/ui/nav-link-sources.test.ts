// One "you are here" for a navigation link (UI consistency scan: NAV-09). These
// checks read the sources, so a router `Link` that sets its own `aria-current`
// (which the router then overrides whenever the location is at or below its path),
// or one wrapped in a `LinkTab` (which is a `NavLink` itself), fails here with the
// file named instead of drifting back.
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stripComments, walk } from '#/shared/testing/source-tree'

const ROOT = join(import.meta.dirname, '..', '..', '..')

const FILES = walk(join(ROOT, 'src'))
  .filter((path) => /\.tsx$/u.test(path) && !/\.(stories|test)\./u.test(path))
  .map((path) => ({
    path: relative(ROOT, path),
    text: stripComments(readFileSync(path, 'utf8')),
  }))

/** An opening `<Link` tag, with its props, up to the `>` that closes it. */
function linkTags(text: string): string[] {
  const tags: string[] = []
  for (const match of text.matchAll(/<Link\b/gu)) {
    let depth = 0
    let quote: string | null = null
    for (let index = match.index; index < text.length; index += 1) {
      const char = text[index]
      if (quote !== null) {
        if (char === quote) quote = null
      } else if (char === '"' || char === "'" || char === '`') quote = char
      else if (char === '{') depth += 1
      else if (char === '}') depth -= 1
      else if (char === '>' && depth === 0) {
        tags.push(text.slice(match.index, index + 1))
        break
      }
    }
  }
  return tags
}

function writesCurrent(text: string): boolean {
  return linkTags(text).some((tag) => /\baria-current\b/u.test(tag))
}

/** Each `<LinkTab ...>...</LinkTab>`, whole (`<LinkTabs` is the row, not a tab). */
function linkTabs(text: string): string[] {
  return text.match(/<LinkTab\b[\s\S]*?<\/LinkTab>/gu) ?? []
}

/**
 * Files whose `<Link aria-current>` is not a nav row. Empty: the page-level view
 * tabs that were the last of them are `LinkTab`s now. An entry needs a reason, and
 * the check below fails when the reason is gone.
 */
const ALLOWED: Readonly<Record<string, string>> = {}

describe('a navigation link names its current page through NavLink', () => {
  it('is `<NavLink current>`, not a `<Link aria-current>` the router overrides', () => {
    const offenders = FILES.filter(
      (file) => !(file.path in ALLOWED) && writesCurrent(file.text),
    ).map((file) => file.path)

    expect(offenders).toEqual([])
  })

  it('keeps the allowlist honest: every entry still writes one', () => {
    const stale = Object.keys(ALLOWED).filter(
      (path) => !FILES.some((file) => file.path === path && writesCurrent(file.text)),
    )

    expect(stale).toEqual([])
  })

  it('never wraps a router Link in a LinkTab: a LinkTab is the link itself', () => {
    const offenders = FILES.filter((file) =>
      linkTabs(file.text).some((tab) => /<Link\b/u.test(tab)),
    ).map((file) => file.path)

    expect(offenders).toEqual([])
  })
})

describe('the link scan', () => {
  it('reads a router Link that carries aria-current, however its props are spelled', () => {
    const source =
      '<Link to="/a" search={{ q: "}" }} aria-current={on ? "page" : undefined}>A</Link>'

    expect(writesCurrent(source)).toBe(true)
  })

  it('does not read a NavLink as a router Link', () => {
    expect(writesCurrent('<NavLink to="/a" current>A</NavLink>')).toBe(false)
  })

  it('finds a Link inside a LinkTab and leaves the LinkTabs row alone', () => {
    const wrapped =
      '<LinkTabs><LinkTab active><Link to="/a">A</Link></LinkTab></LinkTabs>'
    const plain = '<LinkTabs><LinkTab to="/a" current>A</LinkTab></LinkTabs>'

    expect(linkTabs(wrapped).some((tab) => /<Link\b/u.test(tab))).toBe(true)
    expect(linkTabs(plain).some((tab) => /<Link\b/u.test(tab))).toBe(false)
  })
})
