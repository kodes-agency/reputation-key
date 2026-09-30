import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OwnerDisc } from './owner-disc'

function render(props: Parameters<typeof OwnerDisc>[0]): string {
  return renderToStaticMarkup(createElement(OwnerDisc, props))
}

describe('OwnerDisc', () => {
  it('draws the initials in a 20 px round disc and hides them from assistive tech', () => {
    const html = render({ initials: 'GH', tone: 'neutral' })

    expect(html).toContain('>GH<')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('size-5')
    expect(html).toContain('rounded-full')
  })

  it('wears ink on the border tone as a neutral fact and the accent tone as a control', () => {
    const neutral = render({ initials: 'GH', tone: 'neutral' })
    const accent = render({ initials: 'GH', tone: 'accent' })

    expect(neutral).toContain('bg-border')
    expect(neutral).not.toContain('bg-accent')
    expect(accent).toContain('bg-accent')
    expect(accent).not.toContain('bg-border')
  })

  it('lets a caller add hover styling of its own', () => {
    const html = render({
      initials: 'GH',
      tone: 'accent',
      className: 'group-hover/owner:bg-background',
    })

    expect(html).toContain('group-hover/owner:bg-background')
  })

  it('draws a plain person glyph, never an empty disc, when nobody holds it', () => {
    const html = render({ initials: null, isAssigned: false, tone: 'neutral' })

    expect(html).toContain('<svg')
    expect(html).toContain('lucide-user-round')
    expect(html).not.toContain('lucide-user-round-check')
    expect(html).not.toContain('rounded-full')
  })

  it('draws the checked person glyph when someone holds it but has no name to show', () => {
    const html = render({ initials: null, isAssigned: true, tone: 'neutral' })

    expect(html).toContain('lucide-user-round-check')
  })

  it('shrinks the fallback glyph beside a fact but leaves a control glyph to its button', () => {
    const fact = render({ initials: null, isAssigned: true, tone: 'neutral' })
    const control = render({ initials: null, isAssigned: true, tone: 'accent' })

    expect(fact).toContain('size-3.5')
    expect(control).not.toContain('size-3.5')
  })
})
