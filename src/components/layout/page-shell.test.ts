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

// A pane that must wear a different gutter than the page's goes here with the
// reason, never in the pattern. Empty today: the editor strip's own `xl:px-3`
// and the review footer's own height are written beside PAGE_GUTTER_X, not
// instead of it.
const DIFFERENT_ON_PURPOSE: ReadonlySet<string> = new Set<string>([])

// The two ways a component spells the 16 / 24 px sides out. The wide patterns
// allow other classes (a vertical `py-5`, a border) between the two halves but
// stay inside one string literal, so `px-4 py-5 md:px-6` is caught while the
// `max-md:px-4` of the phone bleed and a `md:px-8` aside are not.
const PX_4 = String.raw`(?<![\w:-])px-4(?![\w-])`
const MD_PX_6 = String.raw`(?<![\w:-])md:px-6(?![\w-])`
const WITHIN_A_STRING = String.raw`[^'"\x60\n]*?`

const SPELLED_OUT: ReadonlyArray<RegExp> = [
  /px-4 py-5 md:px-6 md:py-8/u,
  new RegExp(`${PX_4}${WITHIN_A_STRING}${MD_PX_6}`, 'u'),
  new RegExp(`${MD_PX_6}${WITHIN_A_STRING}${PX_4}`, 'u'),
]

describe('the page gutter has one owner', () => {
  it('catches the gutter however the vertical padding is written between its halves', () => {
    const spelledOut = (text: string) => SPELLED_OUT.some((pattern) => pattern.test(text))

    expect(spelledOut('px-4 md:px-6')).toBe(true)
    expect(spelledOut('min-w-0 flex-1 px-4 py-5 md:px-6')).toBe(true)
    expect(spelledOut('border-t px-4 py-5 md:px-6 lg:w-[22rem]')).toBe(true)
    expect(spelledOut('flex-1 space-y-8 px-4 py-5 md:px-6 md:py-6')).toBe(true)
    expect(spelledOut('md:px-6 py-5 px-4')).toBe(true)
    // Not the gutter: the phone bleed, a wider aside, a different phone side.
    expect(spelledOut('max-md:-mx-4 max-md:px-4')).toBe(false)
    expect(spelledOut('px-4 py-5 md:px-8')).toBe(false)
    expect(spelledOut('px-4 py-2 md:px-5')).toBe(false)
    // Two separate strings are two elements, not one spelled-out gutter.
    expect(spelledOut(`'px-4 py-2', 'md:px-6'`)).toBe(false)
  })

  it('is not spelled out in any component, route or style helper', () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => path !== OWNER && !/\.test\.tsx?$/u.test(path))
      .map((path) => relative(SRC, path).split(sep).join('/'))
      .filter((path) => !DIFFERENT_ON_PURPOSE.has(path))
      .filter((path) => {
        const text = readFileSync(join(SRC, path), 'utf8')
        return SPELLED_OUT.some((pattern) => pattern.test(text))
      })

    expect(offenders).toEqual([])
  })
})
