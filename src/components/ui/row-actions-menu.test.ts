// RowActionsMenu (UI consistency scan: COLL-02, ACT-06).
//
// "Act on one row" was a three-dots button built per screen: 24, 32, 36 and 44
// px, ghost or outline, with four phrasings of the same name ("More actions for
// X", "More actions for: X", "Actions for X", "More code actions"), a hand-typed
// ellipsis on some dialog-opening items and not on others, and destructive items
// coloured two ways. The trigger, its name, its size and the item rules are one
// primitive now.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RowActionsMenu, rowActionsLabel } from './row-actions-menu'
import { TooltipProvider } from './tooltip'

type Props = Parameters<typeof RowActionsMenu>[0]

function render(props: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(RowActionsMenu, {
        name: 'Harborline Suites',
        children: null,
        ...props,
      }),
    ),
  )
}

describe('rowActionsLabel', () => {
  it('names the trigger "More actions for {name}", never with a colon', () => {
    expect(rowActionsLabel('Harborline Suites')).toBe(
      'More actions for Harborline Suites',
    )
    expect(rowActionsLabel('Pool & Terrace')).toBe('More actions for Pool & Terrace')
  })
})

describe('RowActionsMenu trigger', () => {
  it('is a ghost icon button named after the row', () => {
    const html = render()

    expect(html).toContain('aria-label="More actions for Harborline Suites"')
    expect(html).toContain('data-variant="ghost"')
    expect(html).toContain('data-size="icon-sm"')
    expect(html).toContain('aria-haspopup="menu"')
  })

  it('is a touch target below md, from the token and not a per-file class', () => {
    const html = render()

    expect(html).toContain('max-md:min-h-(--control-touch)')
    expect(html).toContain('max-md:min-w-(--control-touch)')
  })

  it('draws the one three-dots glyph, hidden from assistive tech', () => {
    expect(render()).toMatch(/<svg[^>]*lucide-ellipsis[^>]*aria-hidden="true"/u)
  })

  it('adds no title: the open menu says what it is, so one name and no hint', () => {
    expect(render()).not.toContain('title=')
  })

  it('wears the muted ink in a ghost trigger, and not in an outline one', () => {
    expect(render()).toContain('text-muted-foreground')
    expect(render({ variant: 'outline' })).toContain('data-variant="outline"')
    expect(render({ variant: 'outline' })).not.toContain('text-muted-foreground')
  })

  it('has a small size for a dense feed row that is still a tap target on a phone', () => {
    const html = render({ size: 'small' })

    expect(html).toContain('data-size="icon-xs"')
    expect(html).toContain('max-md:min-h-(--control-touch)')
    expect(html).toContain('max-md:min-w-(--control-touch)')
  })

  it('can be disabled, keeping its name', () => {
    const html = render({ disabled: true })

    expect(html).toContain('disabled=""')
    expect(html).toContain('aria-label="More actions for Harborline Suites"')
  })

  it('passes data attributes to the trigger, as a row that reveals it on hover needs', () => {
    expect(render({ 'data-row-control': 'menu' } as Partial<Props>)).toContain(
      'data-row-control="menu"',
    )
  })

  it('cannot be built without a name', () => {
    // @ts-expect-error the name is required: it is the trigger's accessible name
    const nameless: Props = { children: null }
    expect(nameless).toBeDefined()
  })
})
