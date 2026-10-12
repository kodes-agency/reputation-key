// A rating as a figure is drawn one way: the number to one decimal, one star in
// the rating token, and "stars" said aloud for a reader who cannot see the glyph.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RatingFigure, type RatingFigureProps } from './rating-figure'

const render = (props: RatingFigureProps) =>
  renderToStaticMarkup(createElement(RatingFigure, props))

describe('RatingFigure', () => {
  it.each([
    [4.3, '4.3'],
    [4, '4.0'],
    [4.25, '4.3'],
    [5, '5.0'],
  ])('prints %f as %s', (value, text) => {
    expect(render({ value })).toContain(`>${text}</span>`)
  })

  it('draws one star in the rating token, hidden from assistive technology', () => {
    const html = render({ value: 4.3 })

    expect(html.match(/<svg/gu)).toHaveLength(1)
    expect(html).toContain('text-rating')
    expect(html).toContain('fill-current')
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/u)
  })

  it('says "stars" for a screen reader, and prints no star character', () => {
    const html = render({ value: 4.3 })

    expect(html).toContain('<span class="sr-only">stars</span>')
    expect(html).not.toContain('★')
  })

  it.each([
    ['sm', 'size-3.5'],
    ['md', 'size-4'],
    ['lg', 'size-6'],
  ] as const)('sizes the %s star to %s', (size, glyph) => {
    expect(render({ value: 4.3, size })).toContain(glyph)
  })

  it('takes a class from the caller for weight and placement', () => {
    expect(render({ value: 4.3, className: 'font-medium' })).toContain('font-medium')
  })
})
