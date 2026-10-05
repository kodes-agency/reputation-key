// The Inbox's one h1 (UI consistency scan: FRAME-10). The queue's name was an h1 inside
// a `max-md:hidden` box, so on a phone the page had no h1 at all (a `display: none`
// heading is not in the outline). It stays in the page at every width and is only
// drawn from `md`: the phone's queue strip names the queue on screen.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '#/components/ui/tooltip'
import { InboxListHeader } from './inbox-list-header'
import { CLEARED_INBOX_LIST_FILTERS } from './inbox-filters'

const header = createElement(InboxListHeader, {
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
})
const markup = renderToStaticMarkup(createElement(TooltipProvider, null, header))

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
