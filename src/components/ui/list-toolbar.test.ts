import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ListToolbar, ListToolbarStatus } from './list-toolbar'

describe('ListToolbar', () => {
  it('lays its controls in one wrapping row', () => {
    const html = renderToStaticMarkup(
      createElement(ListToolbar, null, createElement('span', null, 'a')),
    )

    expect(html).toContain('data-slot="list-toolbar"')
    expect(html).toContain('flex-wrap')
    expect(html).toContain('items-center')
    expect(html).toContain('gap-2')
  })
})

describe('ListToolbarStatus', () => {
  it('keeps the count and its Clear in one unit, so the row wraps them together', () => {
    const html = renderToStaticMarkup(
      createElement(ListToolbarStatus, null, createElement('span', null, '1 of 4')),
    )

    expect(html).toContain('data-slot="list-toolbar-status"')
    expect(html).toContain('flex')
    expect(html).toContain('items-center')
    expect(html).toContain('gap-2')
  })
})
