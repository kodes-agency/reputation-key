import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ListToolbar } from './list-toolbar'

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
