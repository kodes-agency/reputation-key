// BackIconButton (UI consistency scan: ACT-12). The back control for a row with no room
// for words (the Inbox's detail pane): the same arrow as BackLink and BackButton, alone,
// with the label as its name and its tooltip.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BackIconButton } from './back-icon-button'
import { TooltipProvider } from './tooltip'

function render(props: Readonly<Record<string, unknown>> = {}): string {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(BackIconButton as never, { label: 'Back to list', ...props }),
    ),
  )
}

describe('BackIconButton', () => {
  it('is only the arrow, named by its label', () => {
    const html = render()

    expect(html).toContain('aria-label="Back to list"')
    expect(html).toContain('lucide-arrow-left')
    expect(html).not.toContain('>Back to list<')
  })

  it('is a square ghost Button that never submits a form', () => {
    const html = render()

    expect(html).toContain('data-variant="ghost"')
    expect(html).toContain('data-size="icon-sm"')
    expect(html).toContain('type="button"')
  })

  it('shows its label as a tooltip, as every icon-only control does', () => {
    expect(render()).toContain('data-state="closed"')
  })

  it('is flush when asked: the arrow, not the 36 px box, sits on the content edge', () => {
    expect(render({ flush: true })).toContain('-ml-2.5')
    expect(render()).not.toContain('-ml-2.5')
  })
})
