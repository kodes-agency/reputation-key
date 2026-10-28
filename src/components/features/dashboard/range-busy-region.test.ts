import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RangeBusyRegion } from './range-busy-region'

const render = (busy: boolean) =>
  renderToStaticMarkup(
    createElement(RangeBusyRegion, {
      busy,
      children: createElement('p', null, 'Figures'),
    }),
  )

describe('RangeBusyRegion', () => {
  it('is quiet while the range on screen is the one chosen', () => {
    const html = render(false)

    expect(html).toContain('aria-busy="false"')
    expect(html).not.toContain('opacity-60')
    expect(html).toContain('Figures')
  })

  it('dims the figures and marks the region busy while the next range is read', () => {
    const html = render(true)

    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('opacity-60')
  })

  it('spaces its children as the page shell does, so wrapping them moves nothing', () => {
    expect(render(false)).toContain('space-y-5')
    expect(render(false)).toContain('md:space-y-8')
  })

  it('fades in 150ms and not at all for a reader who asked for no motion', () => {
    const html = render(true)

    expect(html).toContain('transition-opacity')
    expect(html).toContain('duration-150')
    expect(html).toContain('motion-reduce:transition-none')
  })
})
