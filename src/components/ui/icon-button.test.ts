// IconButton (UI consistency scan: ACT-16, SURF-12).
//
// An icon-only control has no words of its own, so the name is a required prop:
// it becomes the accessible name, and, unless a caller opts out, the tooltip a
// mouse or keyboard user reads. The size is a square Button size, so it follows
// the same touch and compact density as every other control.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { IconButton } from './icon-button'
import { TooltipProvider } from './tooltip'

type Props = Parameters<typeof IconButton>[0]

function render(props: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(IconButton, {
        label: 'Refresh',
        children: createElement('i', { 'data-glyph': 'refresh' }),
        ...props,
      }),
    ),
  )
}

describe('IconButton', () => {
  it('names the button by its label', () => {
    expect(render()).toContain('aria-label="Refresh"')
  })

  it('is a square ghost Button that never submits a form by accident', () => {
    const html = render()

    expect(html).toContain('data-slot="button"')
    expect(html).toContain('data-size="icon"')
    expect(html).toContain('data-variant="ghost"')
    expect(html).toContain('type="button"')
  })

  it('takes the square sizes, and so their touch height', () => {
    const html = render({ size: 'icon-sm' })

    expect(html).toContain('data-size="icon-sm"')
    expect(html).toContain('max-md:min-w-(--control-touch)')
  })

  it('draws the glyph it is given', () => {
    expect(render()).toContain('data-glyph="refresh"')
  })

  it('shows its label as a tooltip by default', () => {
    // Only the tooltip's trigger carries a state attribute on a closed button.
    expect(render()).toContain('data-state="closed"')
  })

  it('goes without a tooltip when asked to, keeping its name', () => {
    const html = render({ tooltip: false })

    expect(html).not.toContain('data-state=')
    expect(html).toContain('aria-label="Refresh"')
  })

  it.each(['menu', 'dialog', 'true'] as const)(
    'goes without a tooltip when it opens a popup (aria-haspopup="%s")',
    (haspopup) => {
      const html = render({ 'aria-haspopup': haspopup })

      expect(html).not.toContain('data-state=')
      expect(html).toContain('aria-label="Refresh"')
    },
  )

  it('keeps its tooltip when aria-haspopup is false', () => {
    expect(render({ 'aria-haspopup': 'false' })).toContain('data-state="closed"')
  })

  it('does not add a title: one hint, not two', () => {
    expect(render()).not.toContain('title=')
  })

  it('passes the Button props through (disabled, class, data attributes)', () => {
    const html = render({ disabled: true, className: 'text-muted-foreground' })

    expect(html).toContain('disabled=""')
    expect(html).toContain('text-muted-foreground')
  })

  it('shows the spinner in place of the glyph while pending', () => {
    const html = render({ pending: true })

    expect(html).toContain('animate-spin')
    expect(html).not.toContain('data-glyph')
  })

  it('cannot be built without a name', () => {
    // @ts-expect-error the label is required: an icon alone is nameless
    const nameless: Props = { children: createElement('i') }
    expect(nameless).toBeDefined()
  })
})
