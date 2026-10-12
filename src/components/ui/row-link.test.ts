// The row link recipes (UI consistency scan: COLL-20) and where they are used.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROW_FIGURE_LINK, ROW_LINK_SURFACE, ROW_NAME_LINK } from './row-link'

describe('row link recipes', () => {
  it('underline on hover and show the focus ring, in every recipe that is a text link', () => {
    for (const recipe of [ROW_NAME_LINK, ROW_FIGURE_LINK]) {
      expect(recipe).toContain('underline-offset-4')
      expect(recipe).toContain('hover:underline')
      expect(recipe).toContain('focus-ring')
    }
  })

  it('keeps the name in the accent ink and names the ink of a figure', () => {
    expect(ROW_NAME_LINK).not.toMatch(/\btext-/u)
    expect(ROW_FIGURE_LINK).toContain('text-foreground')
    expect(ROW_FIGURE_LINK).not.toContain('text-link')
  })

  it('tints a row link on hover with one tint', () => {
    expect(ROW_LINK_SURFACE).toContain('hover:bg-muted/40')
    expect(ROW_LINK_SURFACE).toContain('focus-ring')
  })

  it('needs no important modifier to beat the anchor default', () => {
    for (const recipe of [ROW_NAME_LINK, ROW_FIGURE_LINK, ROW_LINK_SURFACE]) {
      expect(recipe).not.toMatch(/(^|\s)!|!(\s|$)/u)
    }
  })
})

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

const FILES = ['src/components', 'src/routes']
  .flatMap((source) => walk(join(ROOT, source)))
  .map((path) => ({ path: relative(ROOT, path), text: readFileSync(path, 'utf8') }))

describe('the row link convention in the sources', () => {
  it('is imported, not copied: no file keeps its own FOCUS_RING for a row link', () => {
    const copies = FILES.filter((file) => /\bconst FOCUS_RING\b/u.test(file.text)).map(
      (file) => file.path,
    )

    expect(copies).toEqual([])
  })
})
