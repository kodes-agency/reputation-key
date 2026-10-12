// The Inbox's one h1 (UI consistency scan: FRAME-10). The queue's name was an h1 inside
// a `max-md:hidden` box, so on a phone the page had no h1 at all (a `display: none`
// heading is not in the outline). It stays in the page at every width and is only
// drawn from `md`: the phone's queue strip names the queue on screen. Search and the
// selection toolbar take the header over and the drawn heading with it, so the h1 is
// then read and not drawn at every width, and the page still has exactly one.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '#/components/ui/tooltip'
import { InboxListHeader } from './inbox-list-header'
import { CLEARED_INBOX_LIST_FILTERS } from './inbox-filters'

const baseProps = {
  queueLabel: 'Needs reply',
  scopeLabel: 'Hotel Elegance',
  totalCount: 18,
  queueTotal: 42,
  searchQ: undefined,
  filters: CLEARED_INBOX_LIST_FILTERS,
  sort: 'newest',
  onSearchChange: () => undefined,
  onFiltersChange: () => undefined,
  onSortChange: () => undefined,
  onClearFilters: () => undefined,
} as const

const render = (props: Partial<Parameters<typeof InboxListHeader>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(InboxListHeader, { ...baseProps, ...props }),
    ),
  )

const markup = render()
const headings = (html: string) => html.match(/<h1[\s>]/gu) ?? []

describe('InboxListHeader heading', () => {
  it('has the queue name as its h1', () => {
    expect(markup).toMatch(/<h1[^>]*>Needs reply<\/h1>/u)
  })

  it('keeps the h1 in the page on a phone: hidden from sight, never display: none', () => {
    const h1 = /<h1([^>]*)>/u.exec(markup)![1]!

    expect(h1).toContain('max-md:sr-only')
    expect(h1).not.toMatch(/max-md:hidden|\bhidden\b/u)
  })

  it('sits in no box that is hidden on a phone', () => {
    const before = markup.slice(0, markup.indexOf('<h1'))
    const parent = /<[a-z]+[^<>]*>$/u.exec(before)![0]

    expect(parent).not.toContain('hidden')
  })

  it('hides only the count on a phone', () => {
    expect(markup).toMatch(/<span[^>]*max-md:hidden[^>]*>18<\/span>/u)
  })
})

describe('InboxListHeader heading while the header is taken over', () => {
  it('keeps exactly one h1 in the default state', () => {
    expect(headings(markup)).toHaveLength(1)
  })

  it('keeps one h1, read and not drawn, while search is open', () => {
    const html = render({ searchQ: 'breakfast' })

    expect(headings(html)).toHaveLength(1)
    expect(html).toMatch(/<h1[^>]*class="sr-only"[^>]*>Needs reply<\/h1>/u)
  })

  it('keeps one h1, read and not drawn, while the selection toolbar is shown', () => {
    const html = render({ selectionToolbar: createElement('div', null, '3 selected') })

    expect(headings(html)).toHaveLength(1)
    expect(html).toMatch(/<h1[^>]*class="sr-only"[^>]*>Needs reply<\/h1>/u)
    expect(html).toContain('3 selected')
  })
})
