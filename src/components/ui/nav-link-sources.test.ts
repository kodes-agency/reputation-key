// One "you are here" for a navigation link (UI consistency scan: NAV-09). These
// checks read the sources, so a router `Link` that sets its own `aria-current`
// (which the router then overrides whenever the location is at or below its path)
// fails here with the file named instead of drifting back.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..', '..', '..')

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return /\.tsx$/u.test(entry.name) && !/\.(stories|test)\./u.test(entry.name)
      ? [path]
      : []
  })
}

/** The source without its comments, which are free to quote the old spelling. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|\s)\/\/.*$/gmu, '$1')
}

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

/** Files whose link is not a nav row, or that another slice of the plan converts. */
const ALLOWED: Readonly<Record<string, string>> = {
  'src/components/features/portal/portal-workspace/portal-workspace-tabs.tsx':
    'page-level view tabs; become Link-backed line tabs in the view-switcher slice (S5 F2)',
}

describe('a navigation link names its current page through NavLink', () => {
  const offenders = walk(join(ROOT, 'src'))
    .map((path) => ({
      path: relative(ROOT, path),
      text: code(readFileSync(path, 'utf8')),
    }))
    .filter(({ path }) => !(path in ALLOWED))
    .filter(({ text }) => linkTags(text).some((tag) => /\baria-current\b/u.test(tag)))
    .map(({ path }) => path)

  it('is `<NavLink current>`, not a `<Link aria-current>` the router overrides', () => {
    expect(offenders).toEqual([])
  })
})
