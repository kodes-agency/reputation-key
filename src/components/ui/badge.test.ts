// Badge tones (UI consistency scan: COLL-05).
//
// Badge offered primary, secondary, destructive and outline, so every status
// colour was a one-off className on an outline badge, with its own border and
// tint. The four tones are variants now, on the same tokens the Alert uses.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Badge } from './badge'

type Variant = NonNullable<Parameters<typeof Badge>[0]['variant']>

// Spelled in pieces: Tailwind scans test files, and a whole class here would
// ship its rule in the stylesheet every page loads.
const FILL_GRADE_RED_TEXT = ['text', 'destructive'].join('-')
const HOVER_STEPS_EDGE = ['[a&]:hover', 'border-current'].join(':')
const HOVER_STEPS_FILL = ['[a&]:hover', 'bg-'].join(':')

function render(variant: Variant, props: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(createElement(Badge, { variant, ...props }, 'Label'))
}

describe('Badge tones', () => {
  it('positive is the healthy state on the positive tokens', () => {
    const html = render('positive')

    expect(html).toContain('bg-positive-muted')
    expect(html).toContain('text-positive')
    expect(html).toContain('border-positive/30')
  })

  it('warn is the needs-attention state on the warn tokens', () => {
    const html = render('warn')

    expect(html).toContain('bg-warn-muted')
    expect(html).toContain('text-warn')
    expect(html).toContain('border-warn-line')
  })

  it('negative is the failed state in the text-grade red', () => {
    const html = render('negative')

    expect(html).toContain('bg-negative-muted')
    expect(html).toContain('text-negative')
    expect(html).not.toContain(FILL_GRADE_RED_TEXT)
  })

  it('neutral is the quiet state on the muted surface', () => {
    const html = render('neutral')

    expect(html).toContain('bg-muted')
    expect(html).toContain('text-muted-foreground')
  })

  it('keeps the variants it already had', () => {
    expect(render('default')).toContain('bg-primary')
    expect(render('secondary')).toContain('bg-secondary')
    expect(render('destructive')).toContain('bg-destructive')
    expect(render('outline')).toContain('border-border')
  })

  it('names the tone for a test or a style hook', () => {
    expect(render('warn')).toContain('data-variant="warn"')
  })

  it('steps the edge, not the fill, under the pointer when it is a link', () => {
    // The tinted fill is what the text contrast was measured on, so a hover
    // that moved it could drop the label under 4.5:1.
    const html = render('warn').replaceAll('&amp;', '&')

    expect(html).toContain(HOVER_STEPS_EDGE)
    expect(html).not.toContain(HOVER_STEPS_FILL)
  })
})
