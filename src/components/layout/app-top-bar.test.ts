import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const STYLES = readFileSync(join(import.meta.dirname, '..', '..', 'styles.css'), 'utf8')
const TOP_BAR = readFileSync(join(import.meta.dirname, 'app-top-bar.tsx'), 'utf8')

describe('AppTopBar frame styles', () => {
  it('uses the one top-bar height token and stays above page content', () => {
    expect(STYLES).toMatch(/--app-top-bar-height:\s*3\.25rem/u)
    expect(STYLES).toMatch(
      /\[data-full-bleed='true'\][^{]*\{[^}]*--app-top-bar-height:\s*2\.75rem/su,
    )
    expect(TOP_BAR).toContain('sticky top-0 z-20')
    expect(TOP_BAR).toContain('h-(--app-top-bar-height)')
    expect(TOP_BAR).toContain('bg-background')
  })

  it('reserves the document gutter only for padded pages without doubling a dialog lock', () => {
    expect(STYLES).toMatch(
      /:root:has\(\[data-frame='page'\]\)\s*\{[^}]*scrollbar-gutter:\s*stable/su,
    )
    expect(STYLES).toMatch(
      /:root:has\(\[data-frame='page'\]\) body\[data-scroll-locked\]\s*\{[^}]*margin-right:\s*0\s*!important/su,
    )
  })
})
