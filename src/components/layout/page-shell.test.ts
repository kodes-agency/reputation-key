// `<main>` owns the page gutter. A full-bleed surface drops it so it can own its
// scroll, and a padded body inside that surface gets the same gutter back from
// one place instead of a fourth copy of the class string. These tests pin that
// place: the frame wears exactly the gutter `<main>` wears, and no component
// spells the gutter out again.

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  FullBleedFrame,
  PAGE_GUTTER,
  PAGE_GUTTER_BLEED_PHONE,
  PAGE_GUTTER_X,
} from './page-shell'

function render(props: Parameters<typeof FullBleedFrame>[0]): string {
  return renderToStaticMarkup(createElement(FullBleedFrame, props))
}

describe('page gutter tokens', () => {
  it('is 16px / 24px on the sides and 20px / 32px above and below', () => {
    expect(PAGE_GUTTER).toBe('px-4 py-5 md:px-6 md:py-8')
  })

  it('has a sides-only form that agrees with the full gutter', () => {
    expect(PAGE_GUTTER_X).toBe('px-4 md:px-6')
    for (const token of PAGE_GUTTER_X.split(' ')) {
      expect(PAGE_GUTTER.split(' ')).toContain(token)
    }
  })

  it('bleeds a phone row out by exactly the phone gutter', () => {
    // The Property settings section row used to hard-code -mx-4 under a gutter
    // that was 40px wide, so it bled 16px of 40.
    expect(PAGE_GUTTER_BLEED_PHONE).toBe('max-md:-mx-4 max-md:px-4')
  })
})

describe('FullBleedFrame', () => {
  it('wears the page gutter', () => {
    const html = render({ children: 'body' })

    expect(html).toContain(`class="${PAGE_GUTTER}"`)
    expect(html).toContain('>body</div>')
  })

  it('owns the scroll only when asked', () => {
    expect(render({ children: 'x' })).not.toContain('overflow-y-auto')

    const scrolling = render({ scroll: true, children: 'x' })
    expect(scrolling).toContain('h-full')
    expect(scrolling).toContain('overflow-y-auto')
  })

  it('keeps the caller class after the gutter, so a width limit can sit beside it', () => {
    const html = render({ className: 'mx-auto w-full max-w-5xl', children: 'x' })

    expect(html).toContain(`class="${PAGE_GUTTER} mx-auto w-full max-w-5xl"`)
  })

  it('renders a labelled region when it is a section', () => {
    const html = render({ as: 'section', 'aria-label': 'Share', children: 'x' })

    expect(html).toMatch(/^<section[^>]*aria-label="Share"/)
  })
})

const SRC = join(__dirname, '..', '..')
const OWNER = join(__dirname, 'page-shell.tsx')

function sourceFiles(dir: string): ReadonlyArray<string> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [path] : []
  })
}

describe('the page gutter has one owner', () => {
  const SPELLED_OUT = [/px-4 py-5 md:px-6 md:py-8/u, /(?<![\w:-])px-4 md:px-6(?![\w-])/u]

  it('is not spelled out in any component, route or style helper', () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => path !== OWNER && !/\.test\.tsx?$/u.test(path))
      .filter((path) => {
        const text = readFileSync(path, 'utf8')
        return SPELLED_OUT.some((pattern) => pattern.test(text))
      })
      .map((path) => relative(SRC, path).split(sep).join('/'))

    expect(offenders).toEqual([])
  })
})
