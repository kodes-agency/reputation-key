import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { KindGlyph, kindMarkerWords, PrivateBadge } from './inbox-kind-marker'

describe('kindMarkerWords', () => {
  it('names a Google review by its platform', () => {
    expect(kindMarkerWords({ sourceType: 'review', platform: 'google' })).toBe(
      'Google review',
    )
    expect(kindMarkerWords({ sourceType: 'review', platform: 'Google' })).toBe(
      'Google review',
    )
  })

  it('names any other review plainly', () => {
    expect(kindMarkerWords({ sourceType: 'review', platform: null })).toBe('Review')
    expect(kindMarkerWords({ sourceType: 'review', platform: 'tripadvisor' })).toBe(
      'Review',
    )
  })

  it('names private feedback whatever its platform field holds', () => {
    expect(kindMarkerWords({ sourceType: 'feedback', platform: null })).toBe(
      'Private feedback',
    )
    expect(kindMarkerWords({ sourceType: 'feedback', platform: 'google' })).toBe(
      'Private feedback',
    )
  })
})

describe('the kind glyphs', () => {
  it('draws a Review as the rating star in the rating token', () => {
    const html = renderToStaticMarkup(
      createElement(KindGlyph, { item: { sourceType: 'review', platform: 'google' } }),
    )

    expect(html).toContain('lucide-star')
    expect(html).toContain('text-rating')
    expect(html).toContain('aria-hidden="true"')
  })

  it('draws private feedback as the locked message, in the quiet ink', () => {
    const html = renderToStaticMarkup(
      createElement(KindGlyph, { item: { sourceType: 'feedback', platform: null } }),
    )

    expect(html).toContain('lucide-message-square-lock')
    expect(html).not.toContain('text-rating')
  })

  it('prints the Private badge as a glyph and a word', () => {
    const html = renderToStaticMarkup(createElement(PrivateBadge))

    expect(html).toContain('lucide-message-square-lock')
    expect(html).toContain('Private')
    expect(html).toContain('data-slot="badge"')
  })
})
